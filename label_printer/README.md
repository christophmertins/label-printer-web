# Etiketten-Studio für Brother QL-Drucker

Gestalte Etiketten für den **Brother QL-500** (und weitere QL-Modelle) im
visuellen Editor: Text, Bilder und QR-Codes frei platzieren, drehen, skalieren,
als Vorlage speichern und drucken. Die App läuft als Panel in der
Home-Assistant-Sidebar.

Das Addon druckt nicht selbst per USB. Es rendert und verwaltet alles lokal und
schickt den fertigen Auftrag an die Etiketten-Instanz, die den Drucker besitzt
(z. B. `http://10.0.0.225:8001`). Läuft dort keine Instanz, bleibt der Editor
voll benutzbar – nur Drucken meldet einen Fehler.
