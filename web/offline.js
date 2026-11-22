// The page the service worker shows when the app opens with no connection: what is wrong, and Try again.
import { translatePage } from "./i18n.js";

translatePage();
document.getElementById("retry").onclick = () => {
  location.reload();
};
addEventListener("online", () => location.reload());
