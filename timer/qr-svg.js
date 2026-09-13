/* Renders a payload as an SVG data URI using the bundled offline QR encoder.
   Shared by the phone-pairing card on the control page and by the pairing panel
   the Android TV app puts on the big screen. */
(function (root) {
  'use strict';

  function svg(payload, quiet) {
    var margin = quiet == null ? 4 : quiet;
    var qr = new root.BJJQRCode(0, 0);
    qr.addData(payload);
    qr.make();
    var count = qr.getModuleCount();
    var side = count + margin * 2;
    var cells = '';
    for (var row = 0; row < count; row++) {
      for (var col = 0; col < count; col++) {
        if (qr.isDark(row, col)) cells += 'M' + (col + margin) + ' ' + (row + margin) + 'h1v1h-1z';
      }
    }
    var markup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + side + ' ' + side +
      '" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h' + side + 'v' + side +
      'H0z"/><path fill="#111" d="' + cells + '"/></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(markup);
  }

  root.GBQr = { svg: svg };
})(typeof globalThis !== 'undefined' ? globalThis : this);
