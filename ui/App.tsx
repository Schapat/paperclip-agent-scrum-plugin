/**
 * Dev-Harness
 *
 * Standalone-Einstiegspunkt für die lokale Entwicklung (`pnpm dev:ui`). Die
 * eigentliche Plugin-Oberfläche liegt in `exports.tsx`; beide rendern denselben
 * Container, damit der Dev-Modus nicht von der ausgelieferten Seite abweicht.
 */

import { ScrumBoardContainer } from './components/ScrumBoardContainer';

export default function App() {
  return <ScrumBoardContainer />;
}
