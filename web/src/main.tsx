import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./styles.css";

registerSW({ immediate: true });

// StrictMode は使わない(開発時に effect が二重に走り、question_shown などのイベントが重複するため)
createRoot(document.getElementById("root")!).render(<App />);
