/** Wire a button to toggle a popover panel; closes on outside click and Escape. */
export function popover(button: HTMLButtonElement, panel: HTMLElement): { close: () => void } {
  const close = () => {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    document.querySelectorAll<HTMLElement>(".popover").forEach((p) => {
      if (p !== panel) p.hidden = true;
    });
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    panel.querySelector<HTMLElement>("button, input, select")?.focus();
  };
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panel.hidden) open();
    else close();
  });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target as Node)) close();
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      button.focus();
    }
  });
  return { close };
}
