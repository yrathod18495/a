// Builds src/character-viewer.js into ONE plain script (public/character-viewer.js) that the admin screen can put inside a downloaded HTML file.
export default {
  build: {
    target: 'es2020', outDir: 'public', emptyOutDir: false, copyPublicDir: false, minify: true,
    lib: { entry: 'src/character-viewer.js', formats: ['iife'], name: 'CharacterViewer', fileName: () => 'character-viewer.js' },
  },
};
