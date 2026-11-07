# Dark mode

Everyone can choose **System**, **Light** or **Dark** in the profile menu (top right, the circle with your initial, above **Sign out**; on a phone it is in the slide-out menu above **Sign out**).

| Choice | What happens |
| --- | --- |
| **System** (the default) | The app follows the device. If the phone or laptop switches to dark in the evening, the app does too, without a reload. |
| **Light** | Always light, whatever the device says. |
| **Dark** | Always dark. |

The choice is kept in this browser only (`cipco_theme` in local storage). A new phone or a cleared browser starts on System. The login page and the public candidate form follow the same rule, using whatever this browser last chose.

Printing and PDFs are always light.

**The logo** is the blue one in light mode and a white one in dark mode, with no tile behind either. Use `<Logo />` (`src/components/Logo.tsx`) wherever the logo is shown; it picks the right file (`public/branding/logo-hd.png` and `logo-white.svg`). The sign-in screen's blue panel always uses the white logo. PDFs still use `logo.png`.

## How it works (for whoever changes the screens)

1. `src/lib/theme.ts` holds the choice. A tiny script (`THEME_BOOT`, inlined in `layout.tsx`) runs before the page paints and puts `class="dark"` on `<html>`, so there is no white flash. It also listens to the device while the choice is System.
2. `src/components/ThemeSwitch.tsx` is the three-way control in the profile menu. It calls `setMode()`.
3. `src/app/dark.css` does the colours. Most screens are written with Tailwind colour classes (`bg-slate-50`, `text-amber-800`, `border-slate-200`), so instead of touching each one, the **colour scale is swapped** when `html.dark` is set:
   - the light tints (50 to 300) become dark tints, and the deep text colours (700 to 900) become light ones;
   - the mid colours (500 to 600: bars, dots, buttons) stay;
   - grey (slate) is a hand-picked ladder because it is used for text and surfaces alike;
   - `bg-white` becomes the card surface, and white text (`text-white`) stays white.
4. `src/app/globals.css` defines the shared pieces (`.card`, `.btn`, `.inp`, `.chip`, `.tab`…) with variables (`--surface`, `--ink`, `--line`, `--brand`…) instead of fixed colours. `dark.css` gives those variables their dark values.

### Writing a new screen

- Use the Tailwind colour classes as before, and it works in both themes. A pale background with dark text (`bg-amber-50 text-amber-800`) becomes a dark background with light text by itself.
- Do **not** put a fixed hex colour in a screen for a surface or for text. Use a Tailwind class or one of the variables above. A fixed colour is fine for something that is the same in both themes (a status dot, a chart line).
- Use `bg-white` for a card or panel, not `bg-[#fff]`.
- A solid dark overlay behind a panel: `bg-slate-900/40` is handled (it stays a dark overlay in dark mode).
- Because `.btn`, `.chip` and similar rules are outside Tailwind's layers, a utility like `md:hidden` does not override their `display`. Put the class on a wrapper `div` instead.

### Checking a screen

Open it with the browser's dark appearance on (or choose Dark in the menu) and look for: text that fades into its background, a white box that stayed white, a border that disappeared. Then choose Light and System and confirm it comes back.
