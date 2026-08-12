import baseStyles from "./styles/index.css";
import ceremonyStyles from "./styles/ceremonies.css";
import kanbanStyles from "./styles/kanban.css";
import onboardingStyles from "./styles/project-onboarding.css";
import settingsStyles from "./styles/settings.css";
import openQuestionStyles from "./styles/open-questions.css";

/**
 * Paperclip dynamically imports the UI entry module but does not load esbuild's
 * adjacent CSS asset. Embed the stylesheet in the JS bundle and scope every
 * selector to the plugin root so it cannot alter the host application.
 */
function scopeStyles(css: string, namespace: string, animationNames: string[] = []): string {
  let scoped = css;
  for (const animationName of animationNames) {
    const namespaced = `agent-scrum-${namespace}-${animationName}`;
    scoped = scoped.replace(new RegExp(`\\b${animationName}\\b`, "g"), namespaced);
  }

  return `@scope (.agent-scrum-root) {\n${scoped}\n}`;
}

const AGENT_SCRUM_STYLES = [
  scopeStyles(baseStyles, "base", ["spin"]),
  scopeStyles(ceremonyStyles, "ceremonies"),
  scopeStyles(kanbanStyles, "kanban", [
    "pulse-warning",
    "skeleton-shimmer",
    "fadeIn",
    "overlayFadeIn",
    "panelSlideIn",
    "spin",
  ]),
  scopeStyles(onboardingStyles, "onboarding", ["workingPulse"]),
  scopeStyles(settingsStyles, "settings", ["fadeIn", "slideUp"]),
  scopeStyles(openQuestionStyles, "open-questions"),
].join("\n");

export function AgentScrumStyleSheet() {
  return <style data-agent-scrum-styles>{AGENT_SCRUM_STYLES}</style>;
}