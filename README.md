# Pokémon-Karten-Checkliste

Statische Checkliste für meine deutschen Illustration Rares und Full Arts, optimiert fürs Smartphone.

- **Abhaken:** Kartenbild antippen. Die Lupe oben rechts öffnet die große Ansicht.
- **Speicherung:** Abhak-Status und eigene Preise liegen im `localStorage` des Browsers. Über **Export / Import** lassen sie sich als JSON-Datei auf andere Geräte übertragen.
- **Preise:** Cardmarket-Richtwerte (`low` = „ab“, `trend`) aus der [TCGdex-API](https://tcgdex.dev). Sie gelten für alle Zustände und Sprachen und werden 24 Stunden zwischengespeichert. Mit „Preise aktualisieren“ lädst du sie sofort neu.
- **Cardmarket-Button:** öffnet `cardmarket.com/de/Pokemon/Products?idProduct=…&language=3&minCondition=3`, also nur deutsche Karten in Excellent oder besser.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Seitengerüst |
| `style.css` | Design (mobile-first, Hell/Dunkel nach System) |
| `app.js` | Logik: Abhaken, Filter, Preise, Export/Import, Lightbox |
| `cards.json` | Reihen und Karten mit geprüften TCGdex-IDs, Bild-URLs und Cardmarket-Produkt-IDs |

Kein Build-Schritt nötig. Lokal testen geht mit einem einfachen Webserver, z. B. `python -m http.server` im Ordner. Ein Doppelklick auf `index.html` reicht nicht, weil `cards.json` dann nicht geladen werden kann.

## Karte hinzufügen

In `cards.json` bei der passenden Reihe unter `slots[].options` einen Eintrag ergänzen. Die `id` muss die TCGdex-Karten-ID sein (z. B. `sv02-196`, prüfbar unter `https://api.tcgdex.net/v2/de/cards/sv02-196`).

Kartenbilder und Daten stammen von TCGdex. Fan-Projekt ohne Verbindung zu Nintendo, Creatures, GAME FREAK, The Pokémon Company oder Cardmarket.
