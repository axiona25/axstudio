import { useState, useCallback } from "react";

let _mediaIdCounter = 1;

export function useMediaLibrary() {
  const [mediaItems, setMediaItems] = useState([]);
  const [filter, setFilter] = useState("all");

  const addMedia = useCallback((file, extraMeta = {}) => {
    const item = {
      id: `media-${Date.now()}-${_mediaIdCounter++}`,
      name: file.name || extraMeta.name || "Untitled",
      type: detectMediaType(file.name || extraMeta.name || ""),
      src: file.objectURL || file.src || extraMeta.src || "",
      url: file.objectURL || file.src || extraMeta.src || "",
      thumbnail: extraMeta.thumbnail || file.objectURL || file.src || extraMeta.src || "",
      duration: extraMeta.duration || 5,
      size: file.size || 0,
      addedAt: Date.now(),
      ...extraMeta,
    };
    setMediaItems(prev => [...prev, item]);
    return item;
  }, []);

  const addMediaBatch = useCallback((items) => {
    const newItems = items.map(item => ({
      id: `media-${Date.now()}-${_mediaIdCounter++}`,
      name: item.name || "Untitled",
      type: detectMediaType(item.name || ""),
      src: item.src || item.url || "",
      url: item.src || item.url || "",
      thumbnail: item.thumbnail || item.src || item.url || "",
      duration: item.duration || 5,
      size: item.size || 0,
      addedAt: Date.now(),
      ...item,
    }));
    setMediaItems(prev => [...prev, ...newItems]);
    return newItems;
  }, []);

  const removeMedia = useCallback((id) => {
    setMediaItems(prev => prev.filter(m => m.id !== id));
  }, []);

  const filteredItems = filter === "all"
    ? mediaItems
    : mediaItems.filter(m => m.type === filter);

  return {
    mediaItems,
    filteredItems,
    filter, setFilter,
    addMedia, addMediaBatch, removeMedia,
    setMediaItems,
  };
}

function detectMediaType(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (["mp4", "mov", "webm", "avi", "mkv", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "ogg", "aac", "flac"].includes(ext)) return "audio";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  return "video";
}
