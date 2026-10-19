import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Prevent external browser extension errors (e.g., wallet or tool extensions injected into iframes)
// from polluting app state or causing unhandled runtime crashes
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    if (
      (event.filename && event.filename.includes("chrome-extension://")) ||
      (event.message && typeof event.message === "string" && event.message.includes("chrome: call method"))
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const msg = typeof reason === "string" ? reason : reason?.message || "";
    const stack = reason?.stack || "";
    if (
      msg.includes("chrome: call method") ||
      stack.includes("chrome-extension://")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
