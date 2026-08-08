# DF-002: Projektauftrag-Start auf Legacy-Boards

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-08

## Problem

Ein leerer Board-State aus einer Plugin-Version vor dem Projekt-Onboarding wird
bei der Migration absichtlich als aktiv behandelt, damit bestehende Automation
nicht unerwartet blockiert wird. Der Worker lässt in diesem leeren Sonderfall
bereits einen neuen Projektauftrag zu. Die UI zeigt jedoch nur für den Status
`not_started` das Eingabeformular und blendet damit den Startpunkt aus.

## Akzeptanzkriterien

- Ein leeres Legacy-Board ohne Projekt, Root-Issue und Sprint zeigt das
  Projektauftrag-Formular.
- Ein Legacy-Board mit bestehenden Tickets oder Sprint bleibt unverändert im
  bisherigen Delivery-Modus.
- Worker und UI verwenden dieselbe Entscheidung für einen neuen Projektauftrag.

## Validierung

- `src/core/__tests__/project-onboarding.test.ts`: 6 Tests bestanden.
- Leeres Legacy-Board in der lokalen Paperclip-Instanz zeigt den
  Projektauftrag-Start nach Plugin-Reload wieder an.