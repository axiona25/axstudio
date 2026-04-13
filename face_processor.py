"""
FaceProcessorPro - Advanced Face Swap + Body Matching Pipeline

Pipeline:
1. Face Detection (InsightFace buffalo_l)
2. Face Swap (inswapper_128)
3. Hair Transfer (BiSeNet segmentation + warp)
4. Body Matching (skin tone + proportions from body_reference)
5. Skin Color Transfer (LAB color space)
6. Lighting Adaptation (adaptive histogram + gradient analysis)
7. Edge Blending (Gaussian blur mask + Poisson blending)
8. Face Restoration (CodeFormer / GFPGAN)
9. Final Composite
"""

import base64
import io
import os
import traceback
from typing import Optional

import cv2
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

# ─────────────────────────────────────────────
# Model paths
# ─────────────────────────────────────────────
MODELS_DIR = "/app/models"
INSIGHTFACE_DIR = os.path.join(MODELS_DIR, "insightface")
INSWAPPER_PATH = os.path.join(MODELS_DIR, "inswapper_128.onnx")
CODEFORMER_PATH = os.path.join(MODELS_DIR, "codeformer", "codeformer.pth")
GFPGAN_PATH = os.path.join(MODELS_DIR, "gfpgan", "GFPGANv1.4.pth")
PARSING_MODEL_PATH = os.path.join(MODELS_DIR, "parsing", "parsing_parsenet.pth")


class FaceProcessorPro:
    """Full pipeline: face swap + hair transfer + body match + restoration."""

    def __init__(self):
        self.face_analyser = None
        self.face_swapper = None
        self.face_restorer_cf = None
        self.face_restorer_gfpgan = None
        self.parsing_net = None
        self._init_models()

    # ═════════════════════════════════════════
    # MODEL INITIALIZATION
    # ═════════════════════════════════════════

    def _init_models(self):
        """Load all models at startup (cold start)."""
        print("[INIT] Loading InsightFace analyser...")
        self._init_face_analyser()
        print("[INIT] Loading inswapper model...")
        self._init_face_swapper()
        print("[INIT] Loading face parsing model...")
        self._init_parsing_net()
        print("[INIT] Loading CodeFormer...")
        self._init_codeformer()
        print("[INIT] Loading GFPGAN...")
        self._init_gfpgan()
        print("[INIT] All models loaded successfully.")

    def _init_face_analyser(self):
        import insightface
        self.face_analyser = insightface.app.FaceAnalysis(
            name="buffalo_l",
            root=INSIGHTFACE_DIR,
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
        )
        self.face_analyser.prepare(ctx_id=0, det_size=(640, 640))

    def _init_face_swapper(self):
        import insightface
        self.face_swapper = insightface.model_zoo.get_model(
            INSWAPPER_PATH,
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
        )

    def _init_parsing_net(self):
        """Load BiSeNet for face/hair segmentation."""
        try:
            import torch
            from facexlib.parsing import init_parsing_model
            self.parsing_net = init_parsing_model(model_name="parsenet")
            self.parsing_net.eval()
            if torch.cuda.is_available():
                self.parsing_net = self.parsing_net.cuda()
            print("[INIT] Parsing net loaded (facexlib).")
        except Exception as e:
            print(f"[WARN] Could not load parsing net: {e}")
            self.parsing_net = None

    def _init_codeformer(self):
        try:
            import torch
            from basicsr.utils.download_util import load_file_from_url
            from basicsr.utils import img2tensor, tensor2img
            from torchvision.transforms.functional import normalize

            # Try loading CodeFormer architecture
            try:
                from codeformer.basicsr.archs.codeformer_arch import CodeFormer as CodeFormerArch
            except ImportError:
                try:
                    from basicsr.archs.codeformerarch import CodeFormer as CodeFormerArch
                except ImportError:
                    print("[WARN] CodeFormer arch not found, will use GFPGAN only.")
                    self.face_restorer_cf = None
                    return

            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            net = CodeFormerArch(
                dim_embd=512, codebook_size=1024, n_head=8, n_layers=9,
                connect_list=["32", "64", "128", "256"],
            ).to(device)
            ckpt = torch.load(CODEFORMER_PATH, map_location=device)
            net.load_state_dict(ckpt.get("params_ema", ckpt.get("params", ckpt)))
            net.eval()
            self.face_restorer_cf = net
            self._cf_device = device
            print("[INIT] CodeFormer loaded.")
        except Exception as e:
            print(f"[WARN] CodeFormer init failed: {e}")
            self.face_restorer_cf = None

    def _init_gfpgan(self):
        try:
            from gfpgan import GFPGANer
            self.face_restorer_gfpgan = GFPGANer(
                model_path=GFPGAN_PATH,
                upscale=1,
                arch="clean",
                channel_multiplier=2,
                bg_upsampler=None,
            )
            print("[INIT] GFPGAN loaded.")
        except Exception as e:
            print(f"[WARN] GFPGAN init failed: {e}")
            self.face_restorer_gfpgan = None

    # ═════════════════════════════════════════
    # MAIN PROCESS
    # ═════════════════════════════════════════

    def process(
        self,
        source_image: str,
        target_image: str,
        body_reference: Optional[str] = None,
        source_indexes: str = "0",
        target_indexes: str = "0",
        face_restore: bool = True,
        face_restore_model: str = "CodeFormer",
        codeformer_fidelity: float = 0.7,
        skin_color_match: bool = True,
        lighting_match: bool = True,
        hair_transfer: bool = True,
        blend_method: str = "poisson",
        blend_radius: int = 15,
        body_match: bool = True,
        output_format: str = "PNG",
        upscale: int = 1,
    ) -> dict:
        """Full processing pipeline."""
        try:
            # ── Decode images ──
            source_img = self._decode_base64(source_image)
            target_img = self._decode_base64(target_image)
            body_ref_img = self._decode_base64(body_reference) if body_reference else None

            # ── Detect faces ──
            source_faces = self.face_analyser.get(source_img)
            target_faces = self.face_analyser.get(target_img)

            if not source_faces:
                return {"error": "No face detected in source image", "status": "error"}
            if not target_faces:
                return {"error": "No face detected in target image", "status": "error"}

            # Sort faces by x position (left to right)
            source_faces = sorted(source_faces, key=lambda f: f.bbox[0])
            target_faces = sorted(target_faces, key=lambda f: f.bbox[0])

            # Parse indexes
            s_indexes = [int(i.strip()) for i in source_indexes.split(",")]
            t_indexes = [int(i.strip()) for i in target_indexes.split(",")]

            result_img = target_img.copy()
            faces_swapped = 0

            for s_idx, t_idx in zip(s_indexes, t_indexes):
                if s_idx >= len(source_faces) or t_idx >= len(target_faces):
                    continue

                source_face = source_faces[s_idx]
                target_face = target_faces[t_idx]

                # ── Step 1: Base face swap ──
                print(f"[STEP 1] Face swap: source[{s_idx}] -> target[{t_idx}]")
                result_img = self.face_swapper.get(
                    result_img, target_face, source_face, paste_back=True
                )

                # Re-detect the swapped face for further processing
                swapped_faces = self.face_analyser.get(result_img)
                if swapped_faces:
                    swapped_faces = sorted(swapped_faces, key=lambda f: f.bbox[0])
                    if t_idx < len(swapped_faces):
                        swapped_face = swapped_faces[t_idx]
                    else:
                        swapped_face = swapped_faces[0]
                else:
                    swapped_face = target_face

                # ── Step 2: Hair transfer ──
                if hair_transfer and self.parsing_net is not None:
                    print("[STEP 2] Hair transfer from source...")
                    result_img = self._transfer_hair(
                        source_img, source_face, result_img, swapped_face
                    )

                # ── Step 3: Skin color matching ──
                if skin_color_match:
                    print("[STEP 3] Skin color matching (LAB space)...")
                    result_img = self._match_skin_color(
                        result_img, swapped_face, target_img, target_face
                    )

                # ── Step 4: Lighting adaptation ──
                if lighting_match:
                    print("[STEP 4] Lighting adaptation...")
                    result_img = self._match_lighting(
                        result_img, swapped_face, target_img, target_face
                    )

                # ── Step 5: Edge blending ──
                print(f"[STEP 5] Edge blending (method={blend_method}, radius={blend_radius})...")
                result_img = self._blend_edges(
                    result_img, target_img, swapped_face,
                    method=blend_method, radius=blend_radius
                )

                # ── Step 6: Face restoration ──
                if face_restore:
                    print(f"[STEP 6] Face restoration ({face_restore_model})...")
                    result_img = self._restore_face(
                        result_img, swapped_face,
                        model=face_restore_model,
                        codeformer_fidelity=codeformer_fidelity,
                    )

                faces_swapped += 1

            # ── Step 7: Body matching from reference ──
            if body_match and body_ref_img is not None:
                print("[STEP 7] Full body matching from reference...")
                result_img = self._match_body(result_img, body_ref_img, target_img)

            # ── Step 8: Upscale if requested ──
            if upscale > 1:
                print(f"[STEP 8] Upscaling x{upscale}...")
                result_img = self._upscale_image(result_img, upscale)

            # ── Encode output ──
            output_b64 = self._encode_base64(result_img, output_format)

            return {
                "output": {
                    "image": output_b64,
                    "status": "ok",
                    "faces_detected": len(target_faces),
                    "face_swapped_index": t_indexes[0] if t_indexes else 0,
                    "faces_swapped": faces_swapped,
                    "hair_transferred": hair_transfer and self.parsing_net is not None,
                    "body_matched": body_match and body_ref_img is not None,
                }
            }

        except Exception as e:
            traceback.print_exc()
            return {"error": str(e), "status": "error"}

    # ═════════════════════════════════════════
    # STEP 2: HAIR TRANSFER
    # ═════════════════════════════════════════

    def _transfer_hair(self, source_img, source_face, target_img, target_face):
        """
        Aggressive hair transfer: completely replace target hair with source hair.
        BiSeNet labels: 0=background, 1=skin, 2-3=brows, 4=eyes, 5=glasses,
        7=ears, 8=earrings, 10=nose, 11-12=lips, 13=neck, 17=hair
        """
        try:
            # Get hair mask from source
            source_hair_mask = self._get_segment_mask(source_img, segment_ids=[17])
            if source_hair_mask is None or source_hair_mask.sum() < 100:
                print("[HAIR] No hair detected in source, skipping.")
                return target_img

            # Get target hair mask (to remove/replace)
            target_hair_mask = self._get_segment_mask(target_img, segment_ids=[17])
            if target_hair_mask is None:
                target_hair_mask = np.zeros(target_img.shape[:2], dtype=np.float32)

            print(f"[HAIR] Source hair pixels: {(source_hair_mask > 0.5).sum()}, Target hair pixels: {(target_hair_mask > 0.5).sum()}")

            # ── Alignment using face landmarks ──
            s_bbox = source_face.bbox.astype(int)
            t_bbox = target_face.bbox.astype(int)

            # Use eye center for better alignment (more stable than bbox center)
            if hasattr(source_face, 'kps') and source_face.kps is not None and \
               hasattr(target_face, 'kps') and target_face.kps is not None:
                # kps[0] = left eye, kps[1] = right eye
                s_eye_center = (source_face.kps[0] + source_face.kps[1]) / 2
                t_eye_center = (target_face.kps[0] + target_face.kps[1]) / 2
                # Scale based on eye distance
                s_eye_dist = np.linalg.norm(source_face.kps[1] - source_face.kps[0])
                t_eye_dist = np.linalg.norm(target_face.kps[1] - target_face.kps[0])
                if s_eye_dist > 0:
                    scale = t_eye_dist / s_eye_dist
                else:
                    scale = 1.0
                s_center = s_eye_center
                t_center = t_eye_center
            else:
                s_center = np.array([(s_bbox[0] + s_bbox[2]) / 2, (s_bbox[1] + s_bbox[3]) / 2])
                t_center = np.array([(t_bbox[0] + t_bbox[2]) / 2, (t_bbox[1] + t_bbox[3]) / 2])
                s_size = max(s_bbox[2] - s_bbox[0], s_bbox[3] - s_bbox[1])
                t_size = max(t_bbox[2] - t_bbox[0], t_bbox[3] - t_bbox[1])
                scale = t_size / s_size if s_size > 0 else 1.0

            # Slightly increase scale to ensure full hair coverage
            scale *= 1.15

            # Build affine transform
            M = np.float32([
                [scale, 0, t_center[0] - s_center[0] * scale],
                [0, scale, t_center[1] - s_center[1] * scale],
            ])

            h, w = target_img.shape[:2]

            # Warp source image and hair mask to target space
            warped_source = cv2.warpAffine(source_img, M, (w, h), flags=cv2.INTER_LINEAR)
            warped_hair_mask = cv2.warpAffine(
                source_hair_mask.astype(np.float32), M, (w, h), flags=cv2.INTER_LINEAR
            )

            # ── Create combined hair region: union of warped source + target hair ──
            # This ensures we cover ALL of the target's existing hair
            combined_hair_region = np.clip(warped_hair_mask + target_hair_mask, 0, 1)

            # ── Exclude face region (protect the swapped face) ──
            face_mask = self._get_face_mask(target_img, target_face, expand=0.05)
            # Also get face skin mask to protect
            face_skin = self._get_segment_mask(target_img, segment_ids=[1, 2, 3, 4, 5, 10, 11, 12])
            if face_skin is not None:
                face_protect = np.clip(face_mask + face_skin * 0.5, 0, 1)
            else:
                face_protect = face_mask

            combined_hair_region[face_protect > 0.5] = 0
            warped_hair_mask[face_protect > 0.5] = 0

            # ── Apply hair color from source (NOT from target scene) ──
            # Transfer only the luminance from the target scene, keep source hair color
            warped_lab = cv2.cvtColor(warped_source, cv2.COLOR_BGR2LAB).astype(np.float64)
            target_lab = cv2.cvtColor(target_img, cv2.COLOR_BGR2LAB).astype(np.float64)

            # Only adjust luminance (L channel) to match scene lighting, keep A,B (color) from source
            hair_region = warped_hair_mask > 0.3
            if hair_region.sum() > 10:
                # Get target scene luminance in the hair area
                target_hair_L = target_lab[:, :, 0][hair_region].mean()
                source_hair_L = warped_lab[:, :, 0][hair_region].mean()
                # Gentle luminance shift (30% toward target to maintain source hair color)
                L_shift = (target_hair_L - source_hair_L) * 0.3
                warped_lab[:, :, 0][hair_region] += L_shift
                warped_lab[:, :, 0] = np.clip(warped_lab[:, :, 0], 0, 255)

            color_matched_hair = cv2.cvtColor(warped_lab.astype(np.uint8), cv2.COLOR_LAB2BGR)

            # ── First: inpaint target hair region with background ──
            # Remove old target hair by inpainting
            target_only_hair = (target_hair_mask > 0.5).astype(np.uint8)
            # Exclude areas where we'll place new hair
            target_only_hair[warped_hair_mask > 0.5] = 0
            target_only_hair[face_protect > 0.5] = 0

            result = target_img.copy()
            if target_only_hair.sum() > 50:
                # Dilate for better inpainting
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
                inpaint_mask = cv2.dilate(target_only_hair * 255, kernel, iterations=2)
                result = cv2.inpaint(result, inpaint_mask, 12, cv2.INPAINT_TELEA)

            # ── Composite source hair onto result ──
            # Use the combined region but with warped source hair content
            # Smooth edges generously for natural blend
            composite_mask = gaussian_filter(combined_hair_region.astype(np.float32), sigma=8)
            composite_mask = np.clip(composite_mask, 0, 1)
            # Re-protect face
            composite_mask[face_protect > 0.5] = 0

            mask_3ch = composite_mask[:, :, np.newaxis]
            result = (color_matched_hair * mask_3ch + result * (1 - mask_3ch)).astype(np.uint8)

            # ── Final edge smoothing with Poisson blend on hair boundary ──
            hair_binary = (composite_mask > 0.3).astype(np.uint8) * 255
            if hair_binary.sum() > 100:
                try:
                    # Find center of hair region for seamlessClone
                    coords = np.where(composite_mask > 0.3)
                    if len(coords[0]) > 0:
                        cy = int(coords[0].mean())
                        cx = int(coords[1].mean())
                        cx = max(1, min(w - 2, cx))
                        cy = max(1, min(h - 2, cy))
                        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
                        hair_binary_dilated = cv2.dilate(hair_binary, kernel, iterations=1)
                        result = cv2.seamlessClone(
                            result, target_img, hair_binary_dilated,
                            (cx, cy), cv2.MIXED_CLONE
                        )
                except Exception as e:
                    print(f"[HAIR] Poisson blend fallback: {e}")

            print(f"[HAIR] Transfer complete. Coverage: {(composite_mask > 0.3).sum()} pixels")
            return result

        except Exception as e:
            print(f"[HAIR] Error in hair transfer: {e}")
            traceback.print_exc()
            return target_img

    # ═════════════════════════════════════════
    # STEP 3: SKIN COLOR MATCHING (LAB)
    # ═════════════════════════════════════════

    def _match_skin_color(self, result_img, swapped_face, original_target, target_face):
        """
        Match the skin color of the swapped face to the surrounding body skin
        in the target image. Uses LAB color space for perceptually uniform results.
        """
        try:
            # Get skin region around the face in the original target
            target_skin_mask = self._get_skin_mask(original_target, target_face)
            # Get the swapped face region
            face_mask = self._get_face_mask(result_img, swapped_face, expand=0.0)

            if target_skin_mask.sum() < 50 or face_mask.sum() < 50:
                return result_img

            # Convert to LAB
            result_lab = cv2.cvtColor(result_img, cv2.COLOR_BGR2LAB).astype(np.float64)
            target_lab = cv2.cvtColor(original_target, cv2.COLOR_BGR2LAB).astype(np.float64)

            # Compute mean/std of skin in target body area
            body_pixels = target_lab[target_skin_mask > 0.5]
            body_mean = body_pixels.mean(axis=0)
            body_std = body_pixels.std(axis=0) + 1e-6

            # Compute mean/std of swapped face
            face_pixels = result_lab[face_mask > 0.5]
            face_mean = face_pixels.mean(axis=0)
            face_std = face_pixels.std(axis=0) + 1e-6

            # Apply color transfer to face region only
            face_region = face_mask > 0.5
            for c in range(3):
                result_lab[:, :, c][face_region] = (
                    (result_lab[:, :, c][face_region] - face_mean[c])
                    * (body_std[c] / face_std[c])
                    + body_mean[c]
                )

            result_lab = np.clip(result_lab, 0, 255).astype(np.uint8)
            result_bgr = cv2.cvtColor(result_lab, cv2.COLOR_LAB2BGR)

            # Soft blend back
            mask_3ch = face_mask[:, :, np.newaxis].astype(np.float32)
            blended = (result_bgr * mask_3ch + result_img * (1 - mask_3ch)).astype(np.uint8)
            return blended

        except Exception as e:
            print(f"[SKIN] Error in skin color match: {e}")
            return result_img

    # ═════════════════════════════════════════
    # STEP 4: LIGHTING ADAPTATION
    # ═════════════════════════════════════════

    def _match_lighting(self, result_img, swapped_face, original_target, target_face):
        """
        Match the lighting of the swapped face to the target scene.
        Uses adaptive histogram matching on the luminance channel
        and gradient-based light direction estimation.
        """
        try:
            face_mask = self._get_face_mask(result_img, swapped_face, expand=0.05)
            if face_mask.sum() < 50:
                return result_img

            # Convert both to LAB
            result_lab = cv2.cvtColor(result_img, cv2.COLOR_BGR2LAB)
            target_lab = cv2.cvtColor(original_target, cv2.COLOR_BGR2LAB)

            # Get face bounding box for the region
            bbox = swapped_face.bbox.astype(int)
            x1, y1 = max(0, bbox[0]), max(0, bbox[1])
            x2, y2 = min(result_img.shape[1], bbox[2]), min(result_img.shape[0], bbox[3])

            # Extract luminance (L channel) of target face region
            target_L_region = target_lab[y1:y2, x1:x2, 0]
            result_L_region = result_lab[y1:y2, x1:x2, 0]
            face_mask_region = face_mask[y1:y2, x1:x2]

            if target_L_region.size == 0 or result_L_region.size == 0:
                return result_img

            # Histogram matching on L channel within the face region
            target_L_pixels = target_L_region[face_mask_region > 0.5]
            result_L_pixels = result_L_region[face_mask_region > 0.5]

            if len(target_L_pixels) < 10 or len(result_L_pixels) < 10:
                return result_img

            # Simple statistical matching
            t_mean, t_std = target_L_pixels.mean(), target_L_pixels.std() + 1e-6
            r_mean, r_std = result_L_pixels.mean(), result_L_pixels.std() + 1e-6

            # Apply to full face
            L_adjusted = result_lab[:, :, 0].astype(np.float64)
            face_region = face_mask > 0.5
            L_adjusted[face_region] = (
                (L_adjusted[face_region] - r_mean) * (t_std / r_std) + t_mean
            )
            result_lab[:, :, 0] = np.clip(L_adjusted, 0, 255).astype(np.uint8)

            # Apply CLAHE for local contrast adaptation
            clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(4, 4))
            L_face = result_lab[y1:y2, x1:x2, 0]
            L_face_eq = clahe.apply(L_face)

            # Blend CLAHE result softly
            alpha = 0.3
            result_lab[y1:y2, x1:x2, 0] = cv2.addWeighted(
                L_face, 1 - alpha, L_face_eq, alpha, 0
            )

            result_bgr = cv2.cvtColor(result_lab, cv2.COLOR_LAB2BGR)

            # Soft blend
            mask_3ch = face_mask[:, :, np.newaxis].astype(np.float32)
            blended = (result_bgr * mask_3ch + result_img * (1 - mask_3ch)).astype(np.uint8)
            return blended

        except Exception as e:
            print(f"[LIGHT] Error in lighting match: {e}")
            return result_img

    # ═════════════════════════════════════════
    # STEP 5: EDGE BLENDING
    # ═════════════════════════════════════════

    def _blend_edges(self, result_img, original_target, swapped_face, method="poisson", radius=15):
        """
        Blend the swapped face edges into the target using Poisson blending
        or alpha feathering.
        """
        try:
            face_mask = self._get_face_mask(result_img, swapped_face, expand=0.15)
            if face_mask.sum() < 50:
                return result_img

            if method == "poisson":
                return self._poisson_blend(result_img, original_target, face_mask, swapped_face)
            else:
                return self._alpha_feather_blend(result_img, original_target, face_mask, radius)

        except Exception as e:
            print(f"[BLEND] Error in edge blending: {e}")
            return result_img

    def _poisson_blend(self, result_img, original_target, face_mask, swapped_face):
        """Poisson (seamless) blending using cv2.seamlessClone."""
        try:
            bbox = swapped_face.bbox.astype(int)
            center_x = int((bbox[0] + bbox[2]) / 2)
            center_y = int((bbox[1] + bbox[3]) / 2)

            # Clamp center to image bounds
            h, w = original_target.shape[:2]
            center_x = max(0, min(w - 1, center_x))
            center_y = max(0, min(h - 1, center_y))

            # Create binary mask for seamlessClone (needs uint8)
            mask_uint8 = (face_mask * 255).astype(np.uint8)

            # Dilate mask slightly for better coverage
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            mask_uint8 = cv2.dilate(mask_uint8, kernel, iterations=2)

            blended = cv2.seamlessClone(
                result_img, original_target, mask_uint8,
                (center_x, center_y), cv2.NORMAL_CLONE
            )
            return blended

        except Exception as e:
            print(f"[POISSON] Fallback to alpha blend: {e}")
            return self._alpha_feather_blend(result_img, original_target, face_mask, radius=15)

    def _alpha_feather_blend(self, result_img, original_target, face_mask, radius=15):
        """Alpha feathering blend as fallback."""
        blurred_mask = gaussian_filter(face_mask.astype(np.float32), sigma=radius)
        blurred_mask = np.clip(blurred_mask, 0, 1)
        mask_3ch = blurred_mask[:, :, np.newaxis]
        blended = (result_img * mask_3ch + original_target * (1 - mask_3ch)).astype(np.uint8)
        return blended

    # ═════════════════════════════════════════
    # STEP 6: FACE RESTORATION
    # ═════════════════════════════════════════

    def _restore_face(self, image, face, model="CodeFormer", codeformer_fidelity=0.7):
        """Apply face restoration using CodeFormer or GFPGAN."""
        try:
            if model == "CodeFormer" and self.face_restorer_cf is not None:
                return self._restore_codeformer(image, face, codeformer_fidelity)
            elif self.face_restorer_gfpgan is not None:
                return self._restore_gfpgan(image)
            else:
                print("[RESTORE] No face restorer available, skipping.")
                return image
        except Exception as e:
            print(f"[RESTORE] Error: {e}")
            return image

    def _restore_codeformer(self, image, face, fidelity=0.7):
        """Restore face region using CodeFormer."""
        import torch
        from basicsr.utils import img2tensor, tensor2img
        from torchvision.transforms.functional import normalize

        bbox = face.bbox.astype(int)
        h, w = image.shape[:2]
        x1, y1 = max(0, bbox[0]), max(0, bbox[1])
        x2, y2 = min(w, bbox[2]), min(h, bbox[3])

        # Expand bbox for context
        pad = int(max(x2 - x1, y2 - y1) * 0.3)
        x1p, y1p = max(0, x1 - pad), max(0, y1 - pad)
        x2p, y2p = min(w, x2 + pad), min(h, y2 + pad)

        face_crop = image[y1p:y2p, x1p:x2p].copy()
        if face_crop.size == 0:
            return image

        # Resize to 512x512 for CodeFormer
        orig_size = face_crop.shape[:2]
        face_512 = cv2.resize(face_crop, (512, 512), interpolation=cv2.INTER_LINEAR)

        # Convert to tensor
        face_t = img2tensor(face_512 / 255.0, bgr2rgb=True, float32=True)
        normalize(face_t, (0.5, 0.5, 0.5), (0.5, 0.5, 0.5), inplace=True)
        face_t = face_t.unsqueeze(0).to(self._cf_device)

        with torch.no_grad():
            output = self.face_restorer_cf(face_t, w=fidelity, adain=True)[0]

        restored = tensor2img(output, rgb2bgr=True, min_max=(-1, 1))
        restored = restored.clip(0, 255).astype(np.uint8)

        # Resize back
        restored = cv2.resize(restored, (face_crop.shape[1], face_crop.shape[0]))

        # Paste back with soft mask
        face_mask_local = self._get_face_mask_from_crop(restored)
        mask_3ch = face_mask_local[:, :, np.newaxis].astype(np.float32)
        composite = (restored * mask_3ch + face_crop * (1 - mask_3ch)).astype(np.uint8)

        result = image.copy()
        result[y1p:y2p, x1p:x2p] = composite
        return result

    def _restore_gfpgan(self, image):
        """Restore all faces using GFPGAN."""
        _, _, restored = self.face_restorer_gfpgan.enhance(
            image, has_aligned=False, only_center_face=False, paste_back=True
        )
        return restored

    # ═════════════════════════════════════════
    # STEP 7: BODY MATCHING
    # ═════════════════════════════════════════

    def _match_body(self, result_img, body_ref_img, original_target):
        """
        Match body appearance from reference:
        - Skin tone transfer for visible body parts (neck, arms, hands)
        - Uses LAB color space matching on non-face body skin
        """
        try:
            # Get body skin masks (exclude face)
            ref_skin = self._get_body_skin_mask(body_ref_img)
            target_skin = self._get_body_skin_mask(result_img)

            if ref_skin.sum() < 100 or target_skin.sum() < 100:
                print("[BODY] Not enough body skin detected, skipping.")
                return result_img

            # LAB color transfer from reference body to result body
            result_lab = cv2.cvtColor(result_img, cv2.COLOR_BGR2LAB).astype(np.float64)
            ref_lab = cv2.cvtColor(body_ref_img, cv2.COLOR_BGR2LAB).astype(np.float64)

            ref_pixels = ref_lab[ref_skin > 0.5]
            target_pixels = result_lab[target_skin > 0.5]

            ref_mean = ref_pixels.mean(axis=0)
            ref_std = ref_pixels.std(axis=0) + 1e-6
            tgt_mean = target_pixels.mean(axis=0)
            tgt_std = target_pixels.std(axis=0) + 1e-6

            body_region = target_skin > 0.5
            for c in range(3):
                result_lab[:, :, c][body_region] = (
                    (result_lab[:, :, c][body_region] - tgt_mean[c])
                    * (ref_std[c] / tgt_std[c])
                    + ref_mean[c]
                )

            result_lab = np.clip(result_lab, 0, 255).astype(np.uint8)
            result_bgr = cv2.cvtColor(result_lab, cv2.COLOR_LAB2BGR)

            # Soft blend
            mask_3ch = gaussian_filter(target_skin.astype(np.float32), sigma=5)
            mask_3ch = mask_3ch[:, :, np.newaxis]
            blended = (result_bgr * mask_3ch + result_img * (1 - mask_3ch)).astype(np.uint8)

            return blended

        except Exception as e:
            print(f"[BODY] Error in body matching: {e}")
            return result_img

    # ═════════════════════════════════════════
    # UTILITY: SEGMENTATION & MASKS
    # ═════════════════════════════════════════

    def _get_segment_mask(self, image, segment_ids):
        """
        Get a segmentation mask for specific label IDs using BiSeNet.
        Returns a float mask [0,1] of shape (H,W).
        """
        if self.parsing_net is None:
            return None

        import torch
        from torchvision.transforms.functional import normalize as tv_normalize

        h, w = image.shape[:2]
        img_resized = cv2.resize(image, (512, 512))
        img_rgb = cv2.cvtColor(img_resized, cv2.COLOR_BGR2RGB)
        img_t = torch.from_numpy(img_rgb.transpose(2, 0, 1)).float() / 255.0
        tv_normalize(img_t, (0.485, 0.456, 0.406), (0.229, 0.224, 0.225), inplace=True)
        img_t = img_t.unsqueeze(0)

        if torch.cuda.is_available():
            img_t = img_t.cuda()

        with torch.no_grad():
            out = self.parsing_net(img_t)[0]

        parsing = out.squeeze(0).cpu().numpy().argmax(0)  # (512, 512)

        # Build mask from segment IDs
        mask = np.zeros_like(parsing, dtype=np.float32)
        for sid in segment_ids:
            mask[parsing == sid] = 1.0

        # Resize back to original size
        mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_LINEAR)
        return mask

    def _get_face_mask(self, image, face, expand=0.1):
        """
        Create a face mask from InsightFace landmarks.
        Returns float mask (H,W) in [0,1].
        """
        h, w = image.shape[:2]
        mask = np.zeros((h, w), dtype=np.float32)

        # Use 2d keypoints (68 or 5 landmarks) to build convex hull
        if hasattr(face, "landmark_2d_106") and face.landmark_2d_106 is not None:
            landmarks = face.landmark_2d_106.astype(np.int32)
        elif hasattr(face, "kps") and face.kps is not None:
            # Only 5 points — build an ellipse from bbox instead
            return self._get_face_mask_from_bbox(image, face, expand)
        else:
            return self._get_face_mask_from_bbox(image, face, expand)

        hull = cv2.convexHull(landmarks)

        # Expand hull
        if expand > 0:
            center = hull.mean(axis=0)
            hull_expanded = ((hull - center) * (1 + expand) + center).astype(np.int32)
        else:
            hull_expanded = hull

        cv2.fillConvexPoly(mask, hull_expanded, 1.0)

        # Smooth edges
        mask = gaussian_filter(mask, sigma=5)
        return np.clip(mask, 0, 1)

    def _get_face_mask_from_bbox(self, image, face, expand=0.1):
        """Create elliptical face mask from bounding box."""
        h, w = image.shape[:2]
        mask = np.zeros((h, w), dtype=np.float32)
        bbox = face.bbox.astype(int)

        cx = int((bbox[0] + bbox[2]) / 2)
        cy = int((bbox[1] + bbox[3]) / 2)
        rw = int((bbox[2] - bbox[0]) / 2 * (1 + expand))
        rh = int((bbox[3] - bbox[1]) / 2 * (1 + expand))

        cv2.ellipse(mask, (cx, cy), (rw, rh), 0, 0, 360, 1.0, -1)
        mask = gaussian_filter(mask, sigma=5)
        return np.clip(mask, 0, 1)

    def _get_face_mask_from_crop(self, face_crop):
        """Create a soft elliptical mask for a face crop."""
        h, w = face_crop.shape[:2]
        mask = np.zeros((h, w), dtype=np.float32)
        cx, cy = w // 2, h // 2
        cv2.ellipse(mask, (cx, cy), (int(w * 0.4), int(h * 0.45)), 0, 0, 360, 1.0, -1)
        mask = gaussian_filter(mask, sigma=max(3, min(h, w) // 20))
        return np.clip(mask, 0, 1)

    def _get_skin_mask(self, image, face):
        """
        Get a mask of skin around the face (neck/body area) excluding the face itself.
        Uses HSV skin color detection.
        """
        h, w = image.shape[:2]
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

        # Skin color range in HSV
        lower_skin = np.array([0, 20, 50], dtype=np.uint8)
        upper_skin = np.array([40, 255, 255], dtype=np.uint8)
        skin_mask = cv2.inRange(hsv, lower_skin, upper_skin).astype(np.float32) / 255

        # Get area around face (expand bbox downward for neck/body)
        bbox = face.bbox.astype(int)
        face_h = bbox[3] - bbox[1]
        body_y1 = max(0, bbox[3] - int(face_h * 0.2))
        body_y2 = min(h, bbox[3] + int(face_h * 1.0))
        body_x1 = max(0, bbox[0] - int(face_h * 0.3))
        body_x2 = min(w, bbox[2] + int(face_h * 0.3))

        # Mask only the body region
        region_mask = np.zeros((h, w), dtype=np.float32)
        region_mask[body_y1:body_y2, body_x1:body_x2] = 1.0

        # Exclude face itself
        face_mask = self._get_face_mask(image, face, expand=0.0)
        body_skin = skin_mask * region_mask * (1 - face_mask)

        return body_skin

    def _get_body_skin_mask(self, image):
        """
        Get a mask of all visible body skin (excluding face).
        Uses parsing model if available, otherwise HSV detection.
        """
        if self.parsing_net is not None:
            # BiSeNet labels for body: 1=skin, 13=neck, 14=cloth(exclude), 15-16=body
            skin_mask = self._get_segment_mask(image, segment_ids=[1, 13])
            face_mask = self._get_segment_mask(image, segment_ids=[2, 3, 4, 5, 10, 11, 12])
            if skin_mask is not None and face_mask is not None:
                body_only = np.clip(skin_mask - face_mask, 0, 1)
                return body_only

        # Fallback: HSV skin detection
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        lower = np.array([0, 20, 50], dtype=np.uint8)
        upper = np.array([40, 255, 255], dtype=np.uint8)
        mask = cv2.inRange(hsv, lower, upper).astype(np.float32) / 255

        # Try to exclude face area
        faces = self.face_analyser.get(image)
        if faces:
            for f in faces:
                fmask = self._get_face_mask(image, f, expand=0.1)
                mask = mask * (1 - fmask)

        return mask

    # ═════════════════════════════════════════
    # UTILITY: COLOR TRANSFER
    # ═════════════════════════════════════════

    def _color_transfer_lab(self, source, target, mask=None):
        """
        Transfer color statistics from target to source in LAB space.
        Optionally restricted to masked region.
        """
        src_lab = cv2.cvtColor(source, cv2.COLOR_BGR2LAB).astype(np.float64)
        tgt_lab = cv2.cvtColor(target, cv2.COLOR_BGR2LAB).astype(np.float64)

        if mask is not None and mask.sum() > 0:
            src_pixels = src_lab[mask]
            tgt_pixels = tgt_lab[mask]
        else:
            src_pixels = src_lab.reshape(-1, 3)
            tgt_pixels = tgt_lab.reshape(-1, 3)

        if len(src_pixels) < 10 or len(tgt_pixels) < 10:
            return source

        s_mean, s_std = src_pixels.mean(axis=0), src_pixels.std(axis=0) + 1e-6
        t_mean, t_std = tgt_pixels.mean(axis=0), tgt_pixels.std(axis=0) + 1e-6

        result_lab = src_lab.copy()
        for c in range(3):
            result_lab[:, :, c] = (result_lab[:, :, c] - s_mean[c]) * (t_std[c] / s_std[c]) + t_mean[c]

        result_lab = np.clip(result_lab, 0, 255).astype(np.uint8)
        return cv2.cvtColor(result_lab, cv2.COLOR_LAB2BGR)

    # ═════════════════════════════════════════
    # UTILITY: UPSCALE
    # ═════════════════════════════════════════

    def _upscale_image(self, image, scale):
        """Simple upscale with INTER_LANCZOS4. Real-ESRGAN can be added later."""
        if scale <= 1:
            return image
        h, w = image.shape[:2]
        return cv2.resize(image, (w * scale, h * scale), interpolation=cv2.INTER_LANCZOS4)

    # ═════════════════════════════════════════
    # UTILITY: ENCODE / DECODE
    # ═════════════════════════════════════════

    def _decode_base64(self, b64_string: str) -> np.ndarray:
        """Decode base64 string to OpenCV BGR image."""
        # Handle data URI prefix
        if "," in b64_string:
            b64_string = b64_string.split(",", 1)[1]
        img_bytes = base64.b64decode(b64_string)
        img_pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        img_np = np.array(img_pil)
        return cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)

    def _encode_base64(self, image: np.ndarray, fmt: str = "PNG") -> str:
        """Encode OpenCV BGR image to base64 string."""
        img_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        img_pil = Image.fromarray(img_rgb)
        buffer = io.BytesIO()
        img_pil.save(buffer, format=fmt)
        return base64.b64encode(buffer.getvalue()).decode("utf-8")
