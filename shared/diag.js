// TEMPORAL: diagnóstico de la barra de estado y del alto de pantalla en iPhone.
// Quitar (este archivo y sus <script>) al acabar.
(function () {
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;left:8px;right:8px;top:35%;z-index:30;margin:0;padding:8px;' +
    'font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap;background:#000c;color:#fff;' +
    'border-radius:8px;pointer-events:none';
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;' +
    'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  // Fixed element pinned to top and bottom: how tall iOS makes fixed layers
  const fixed = document.createElement('div');
  fixed.style.cssText = 'position:fixed;visibility:hidden;top:0;bottom:0;width:1px';
  // How tall each viewport unit resolves to
  const units = ['100vh', '100lvh', '100dvh', '100svh', 'calc(100% + env(safe-area-inset-top,0px))'];
  const unitProbes = units.map(h => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;visibility:hidden;top:0;width:1px;height:' + h;
    return d;
  });
  document.body.append(box, probe, fixed, ...unitProbes);
  const errors = [];
  addEventListener('error', e => { errors.push(e.message); show(); });
  const meta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');

  function show() {
    const cs = getComputedStyle(probe);
    const stage = document.getElementById('stage');
    const canvas = document.querySelector('canvas');
    const vv = window.visualViewport;
    box.textContent =
      'standalone: ' + matchMedia('(display-mode: standalone)').matches +
      '\nsafe top/bottom: ' + cs.paddingTop + ' / ' + cs.paddingBottom +
      '\ninner: ' + innerWidth + 'x' + innerHeight + '  screen: ' + screen.width + 'x' + screen.height +
      '\nvisualViewport: ' + (vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) : '-') +
      '\nhtml client: ' + document.documentElement.clientHeight +
      '  fixed: ' + fixed.getBoundingClientRect().height +
      (stage ? '\nstage: ' + stage.clientWidth + 'x' + stage.clientHeight : '') +
      (canvas ? '\ncanvas: ' + canvas.style.width + ' x ' + canvas.style.height : '') +
      (stage ? '\nstage css height: ' + getComputedStyle(stage).height : '') +
      '\napp-h inline: ' + (document.documentElement.style.getPropertyValue('--app-h') || 'unset') +
      '\nviewport.js: ' + (window.__vp || 'not run') +
      '\nvh lvh dvh svh +top: ' + unitProbes.map(d => Math.round(d.getBoundingClientRect().height)).join(' ') +
      (errors.length ? '\nerrors: ' + errors.join(' | ') : '') +
      '\nversion: 6' +
      '\nstatus-bar meta: ' + (meta ? meta.content : 'none');
  }
  show();
  addEventListener('resize', show);
  setTimeout(show, 500);
})();
