# Pokémon-Karten-Checkliste

Statische Checkliste für meine deutschen Illustration Rares und Full Arts, optimiert fürs Smartphone.

- **Abhaken:** Kartenbild antippen. Die Lupe oben rechts öffnet die große Ansicht.
- **Suche:** Feld über dem Filter, findet Karten nach deutschem oder englischem Namen, Nummer (`199`, `199/165`) und Set-Kürzel (`PAL 196`). Lässt sich mit „Nur fehlende“ / „Nur vorhanden“ kombinieren.
- **Rückgängig:** Nach jedem Antippen erscheint unten kurz „Rückgängig“, falls man sich vertippt hat.
- **Als App & offline:** iPhone: In Safari Teilen → „Zum Home-Bildschirm“. Ein Service Worker (`sw.js`) speichert Seite, Kartendaten und alle einmal angezeigten Bilder, die App funktioniert dann auch ohne Internet. Die Home-Bildschirm-App hat einen eigenen Speicher: vorher in Safari exportieren, in der App importieren.
- **Speicherung:** Abhak-Status und eigene Preise liegen im `localStorage` des Browsers. Über **Export / Import** lassen sie sich als JSON-Datei auf andere Geräte übertragen. Ist die letzte Sicherung älter als 30 Tage (oder gab es noch keine), erinnert ein Hinweis oben daran.
- **Preise:** Cardmarket-Richtwerte (`low` = „ab“, `trend`) aus der [TCGdex-API](https://tcgdex.dev). Sie gelten für alle Zustände und Sprachen und werden 24 Stunden zwischengespeichert. Mit „Preise aktualisieren“ lädst du sie sofort neu.
- **Cardmarket-Button:** öffnet `cardmarket.com/de/Pokemon/Products?idProduct=…&language=3&minCondition=3`, also nur deutsche Karten in Excellent oder besser.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Seitengerüst |
| `style.css` | Design (mobile-first, Hell/Dunkel nach System) |
| `app.js` | Logik: Abhaken, Filter, Suche, Preise, Export/Import, Lightbox |
| `sw.js` | Service Worker für den Offline-Betrieb |
| `manifest.webmanifest`, `icon.png` | App-Name und Symbol für den Home-Bildschirm |
| `cards.json` | Reihen und Karten mit geprüften TCGdex-IDs, Bild-URLs und Cardmarket-Produkt-IDs |

Kein Build-Schritt nötig. Lokal testen geht mit einem einfachen Webserver, z. B. `python -m http.server` im Ordner. Ein Doppelklick auf `index.html` reicht nicht, weil `cards.json` dann nicht geladen werden kann.

## Aufbau von cards.json

- `groups`: Überschriften in Anzeigereihenfolge (`id`, `name`, optional `subtitle`).
- `lines`: Reihen bzw. Kartengruppen. Jede hat eine `group`, einen `type` (Farbe) und optional `name` und `typeLabel`.
- `lines[].slots[]`: ein Platz pro Karte, optional mit `stage` („Basis“, „Phase 1“ …). Ein Platz mit mehreren `options` gilt als erledigt, sobald eine davon abgehakt ist.
- Karte: `id` (TCGdex-ID), `name`, `set`, `number` und optional:
  - `myPrice: [min, max]`: deine Preisspanne. Sie wird als Hauptpreis angezeigt und für die Summen genutzt.
  - `variant`, `tag`: kleine Etiketten über dem Bild.

## Karte hinzufügen

In `cards.json` bei der passenden Reihe unter `slots` einen Eintrag ergänzen. Die `id` muss die TCGdex-Karten-ID sein (z. B. `sv02-196`, prüfbar unter `https://api.tcgdex.net/v2/de/cards/sv02-196`). Karten, die aus `cards.json` entfernt werden, verschwinden beim nächsten Laden auch aus dem gespeicherten Abhak-Status.

Kartenbilder und Daten stammen von TCGdex. Fan-Projekt ohne Verbindung zu Nintendo, Creatures, GAME FREAK, The Pokémon Company oder Cardmarket.
