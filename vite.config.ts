import { defineConfig } from 'vite'

// GitHub Pages liefert ein Projekt-Repo nicht unter der Domain-Wurzel aus,
// sondern unter https://<user>.github.io/<repo-name>/. Deshalb müssen alle
// erzeugten Asset-Pfade dieses Präfix bekommen - sonst funktioniert das
// Deployment zwar lokal (npm run dev), aber nicht auf GitHub Pages.
export default defineConfig({
  base: '/3D-basics/',
})
