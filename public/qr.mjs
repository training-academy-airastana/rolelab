import qrcode from './vendor/qrcode.mjs';

let cachedUrl;
let cachedCode;
export function qrSvg(url, id = 'invitation-qr') {
  if (url !== cachedUrl) {
    cachedCode = qrcode(0, 'M');
    cachedCode.addData(url);
    cachedCode.make();
    cachedUrl = url;
  }
  return cachedCode.createSvgTag({
    scalable: true,
    cellSize: 4,
    margin: 16,
    title: { text: 'QR-код для входа в Rolelab', id: `${id}-title` },
    alt: { text: url, id: `${id}-description` },
  });
}
