"use client";
import { useEffect } from "react";

// Makes a screen honest about what the person may do. The shell sets data-readonly / data-noedit / data-nodelete on <html> from their level in the module on show (lib/perms.ts);
// globals.css already hides primary and red buttons. This covers the rest: it hides plain buttons and links whose words say they change something ("+ Add item", "Edit", "Rename",
// "Issue", "New bill"...) and makes the text boxes of an editor read-only, on every screen and as new content appears, so a screen written later is covered without being touched.
// It is a courtesy to the person (nothing that cannot work is offered); the browser guard (supabase/readOnly.ts) and the database still refuse the actual write.
// Opt a control out with data-keep. Tabs, toggle chips and anything inside a dialog or the shell are never touched.
const ADD = "\\+|add|new|create|import|upload|attach|duplicate|record|submit|send|log|assign|generate|calculate|apply|enable|issue|convert|authori[sz]e";
const CHANGE = "edit|rename|reopen|close|replace|approve|reject|undo|withdraw|take back";   // hidden below Edit
const SAVE = "save|update|discard|change|set|mark";   // hidden at View only: at Create the same buttons save a new entry
const REMOVE = "delete|remove|void|✕|×|archive|cancel (bill|invoice|quotation)";
const re = (words: string) => new RegExp(`^(${words})(\\b|\\s|$)`, "i");
const R_ADD = re(ADD), R_CHANGE = re(CHANGE), R_SAVE = re(SAVE), R_REMOVE = re(REMOVE);
const SKIP = "[role=tab],[aria-pressed],[aria-selected],[data-keep],[role=dialog] *,[role=menuitem],summary,.keep";

function scan() {
  const root = document.documentElement; const ro = root.hasAttribute("data-readonly"), noEdit = root.hasAttribute("data-noedit"), noDel = root.hasAttribute("data-nodelete");
  const main = document.getElementById("main"); if (!main) return;
  main.querySelectorAll<HTMLElement>("button, a.btn, a[class*='btn'], label.btn, [role=button]").forEach((el) => {
    const t = (el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
    const hide = !el.matches(SKIP) && !!t && ((ro && (R_ADD.test(t) || R_SAVE.test(t))) || ((ro || noEdit) && R_CHANGE.test(t)) || ((ro || noEdit || noDel) && R_REMOVE.test(t)));
    if (hide) el.setAttribute("data-ro-hide", ""); else if (el.hasAttribute("data-ro-hide")) el.removeAttribute("data-ro-hide");
  });
  main.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type]), input[type=text], input[type=number], input[type=email], input[type=tel], input[type=url]").forEach((el) => {
    const hint = `${el.getAttribute("placeholder") ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.name}`.toLowerCase();
    const filter = /search|filter|find|type to|look up/.test(hint) || el.closest("[data-keep]");
    // at View the boxes lock; at Create the person still types into a new entry, so they stay open (the browser guard stops changes to existing rows)
    if (ro && !filter) { if (!el.readOnly) { el.readOnly = true; el.setAttribute("data-ro-lock", ""); } }
    else if (el.hasAttribute("data-ro-lock")) { el.readOnly = false; el.removeAttribute("data-ro-lock"); }
  });
}

export default function PermGuard() {
  useEffect(() => {
    let raf = 0; const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(scan); };
    const main = document.getElementById("main"); const mo = new MutationObserver(run);
    if (main) mo.observe(main, { childList: true, subtree: true, characterData: false });
    const ao = new MutationObserver(run); ao.observe(document.documentElement, { attributes: true, attributeFilter: ["data-readonly", "data-noedit", "data-nodelete"] });
    run(); return () => { mo.disconnect(); ao.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return null;
}
