/**
 * Layout condiviso Home «Ultimi risultati»: scroll body + empty state senza min-height %.
 * Importabile da App.js e da ScenografieCompletedFilmsLibrary.
 */

/** Body scrollabile sotto l’header della shelf (flex child con altezza definita dal parent). */
export const HOME_SHELF_SCROLL_AREA = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  overflowX: "hidden",
  overflowY: "auto",
};

/**
 * Centra il placeholder nel body senza forzare content height > scrollport
 * (evita scrollbar con padding + min-height:100% e content-box).
 */
export const HOME_SHELF_EMPTY_WRAP = {
  flex: "1 1 0%",
  minHeight: 0,
  width: "100%",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
};
