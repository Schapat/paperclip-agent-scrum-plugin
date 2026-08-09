# DF-016: Breiter und stabiler Ticketdetail-Dialog

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Der Ticketdetail-Dialog war auf `600px` begrenzt. Dadurch erhielt die obere
Tab-Leiste einen horizontalen Scroller. Unter hohem Content-Druck konnte sie
zusaetzlich auf wenige Pixel zusammenschrumpfen und wirkte dann ueberdeckt oder
verschwunden.

## Ursache

- `max-width: 600px` liess fuer fuenf Tabs zu wenig Breite.
- Die Tab-Leiste hatte `overflow-x: auto` und blieb ein schrumpfbares
  Flex-Element.
- Der Content-Scroller besass kein `min-height: 0`; dadurch konkurrierte er im
  vertikalen Flex-Layout um die sichtbare Hoehe.

## Loesung

- Der Dialog nutzt bis zu `960px` Breite und eine feste, viewport-begrenzte
  Dialoghoehe.
- Header und Tab-Leiste sind nicht mehr schrumpfbar und erhalten eine stabile
  Hintergrund-/Stacking-Ebene.
- Die fuenf Tabs werden als gleich breite Grid-Spalten gerendert, ohne
  horizontalen Scrollbereich.
- Ausschliesslich der Dialoginhalt scrollt vertikal; er ist mit
  `min-height: 0` gegen Flex-Ueberlauf abgesichert.

## Akzeptanzkriterien

- Auf Desktop-Breite ist der Ticketdetail-Dialog deutlich breiter und die
  komplette Tab-Leiste ohne horizontalen Scrollen sichtbar.
- Die Tab-Leiste schrumpft nicht, wird nicht vom Content ueberdeckt und bleibt
  beim Wechseln oder Polling sichtbar.
- Lange Ticketinhalte scrollen ausschliesslich im Content-Bereich.

## Validierung

- Browser-Messung nach dem lokalen Upgrade: `max-width: 960px`, Tab-Leiste mit
  `overflow-x: visible`, `flex-shrink: 0` und fuenf gleich breiten Grid-Spalten.
- Der Content beginnt geometrisch direkt unterhalb der Tab-Leiste und besitzt
  `min-height: 0` sowie vertikalen Scroll.
- Visueller Browser-Screenshot bestaetigt den breiten Dialog und die vollstaendig
  sichtbaren Tabs.
- `node ./esbuild.config.mjs` und lokales `plugin upgrade` sind erfolgreich.