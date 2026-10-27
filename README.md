# Minijuegos

Juegos web (HTML + CSS + JavaScript, sin dependencias) pensados para abrirse
dentro del webview de una app móvil.

## Juegos

| Juego | Ruta |
|-------|------|
| Vuela | [`vuela/`](vuela/) |
| Carrito a la fuga | [`parking/`](parking/) |
| Sudoku 6×6 | [`sudoku/`](sudoku/) |
| Reinas | [`reinas/`](reinas/) |
| Apila | [`apila/`](apila/) |
| Artículo del día | [`palabra/`](palabra/) |

## Estructura

```
index.html          menú de juegos
shared/bridge.js    notify() y getToken(), comunes a todos los juegos
shared/styles.css   estilos de marca comunes
shared/sound.js     sonidos sintetizados (Web Audio), comunes a todos los juegos
vuela/              juego "Vuela" (index.html, game.js, game.css)
parking/            carrito que salta clientes y coches; premios a los 10, 25, 50 y 100 saltos
sudoku/             sudoku 6×6 con tres dificultades y premio según el tiempo
reinas/             una reina por fila, columna y región; 6×6 a 8×8, premio según el tiempo
apila/              torre de bloques; premios al llegar a 10, 25, 50 y 100 bloques
palabra/            artículo del día (5 letras, 6 intentos); words.js tiene las soluciones
```

## Probar en local

Abre `index.html` en el navegador o sirve la carpeta:

```
npx serve .
```

## Publicar en GitHub Pages

Settings → Pages → Source: *Deploy from a branch* → rama `main`, carpeta `/ (root)`.
La web queda en `https://diegosv96.github.io/Minijuegos/`.

## Integración con la app

- La app abre el juego con `?token=...`; el juego solo lo reenvía.
- Al terminar, el juego llama a `notify({type:'game_over', ...})`.
  Por ahora el envío está desactivado (`BRIDGE_ENABLED = false` en
  `shared/bridge.js`) y solo se muestra en la consola.
