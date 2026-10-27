// Liquid Glass refraction. Chromium can run an SVG filter on an element's backdrop, so every glass
// surface gets a displacement map that bends the wallpaper along its rounded edges, the way light
// bends through a thick glass lens. The stylesheet marks surfaces with --lg-depth (the strongest bend,
// in px) and --lg-blur; other browsers keep the stylesheet's plain blur.
(() => {
    const surfaces = '.setup-connection, .rounds-pick, .player-pick, .versus, .test-badge, .start-button, .universal-stats, .arena-toolbar, .match-controls, .model-panel, .model-info, .board, .match-disclosure, .error-banner';
    const chromium = navigator.userAgentData?.brands?.some(({brand}) => brand === 'Chromium');
    if (!chromium || matchMedia('(prefers-reduced-transparency: reduce)').matches) return;

    const ns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(ns, 'svg');
    defs.setAttribute('aria-hidden', 'true');
    defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    document.body.appendChild(defs);
    const filters = new WeakMap();
    let count = 0;

    // Signed distance from (x, y) to the edge of a w×h rounded rectangle; negative inside.
    function edgeDistance(x, y, w, h, r) {
        const qx = Math.abs(x - w / 2) - (w / 2 - r);
        const qy = Math.abs(y - h / 2) - (h / 2 - r);
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    }

    // Red and green hold how far each pixel samples toward the centre: strongest right at the rim and
    // fading to nothing a bezel-width in, so the middle stays clear and the edges magnify and bend.
    function displacementMap(w, h, r, bezel) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext('2d');
        const image = context.createImageData(w, h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const px = x + .5, py = y + .5;
                const inset = -edgeDistance(px, py, w, h, r);
                let dx = 0, dy = 0;
                if (inset > 0 && inset < bezel) {
                    const nx = edgeDistance(px + 1, py, w, h, r) - edgeDistance(px - 1, py, w, h, r);
                    const ny = edgeDistance(px, py + 1, w, h, r) - edgeDistance(px, py - 1, w, h, r);
                    const length = Math.hypot(nx, ny) || 1;
                    const strength = (1 - inset / bezel) ** 2;
                    dx = -nx / length * strength;
                    dy = -ny / length * strength;
                }
                const i = (y * w + x) * 4;
                image.data[i] = 128 + dx * 127;
                image.data[i + 1] = 128 + dy * 127;
                image.data[i + 2] = 128;
                image.data[i + 3] = 255;
            }
        }
        context.putImageData(image, 0, 0);
        return canvas.toDataURL();
    }

    function node(name, attributes, parent) {
        const element = document.createElementNS(ns, name);
        for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
        parent?.appendChild(element);
        return element;
    }

    function refract(surface) {
        const style = getComputedStyle(surface);
        const depth = parseFloat(style.getPropertyValue('--lg-depth')) || 0;
        const w = surface.offsetWidth, h = surface.offsetHeight;
        if (!depth || !w || !h) return;
        const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, w / 2, h / 2);
        const blur = parseFloat(style.getPropertyValue('--lg-blur')) || 0;
        const key = [w, h, radius, depth, blur].join();
        let entry = filters.get(surface);
        if (entry?.key === key) return;
        if (!entry) {
            const id = `liquid-glass-${++count}`;
            const filter = node('filter', {id, x: 0, y: 0, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB'}, defs);
            entry = {
                id, filter,
                blur: node('feGaussianBlur', {in: 'SourceGraphic', result: 'soft'}, filter),
                map: node('feImage', {x: 0, y: 0, preserveAspectRatio: 'none', result: 'map'}, filter),
                bend: node('feDisplacementMap', {in: 'soft', in2: 'map', xChannelSelector: 'R', yChannelSelector: 'G'}, filter),
            };
            filters.set(surface, entry);
        }
        const bezel = Math.max(8, Math.min(radius * .9, Math.min(w, h) / 2, 32));
        entry.key = key;
        entry.filter.setAttribute('width', w);
        entry.filter.setAttribute('height', h);
        entry.blur.setAttribute('stdDeviation', blur);
        entry.map.setAttribute('width', w);
        entry.map.setAttribute('height', h);
        entry.map.setAttribute('href', displacementMap(w, h, radius, bezel));
        entry.bend.setAttribute('scale', depth * 2);
        surface.style.setProperty('--lg-refract', `url(#${entry.id})`);
    }

    const observer = new ResizeObserver(entries => {
        for (const {target} of entries) refract(target);
    });
    for (const surface of document.querySelectorAll(surfaces)) observer.observe(surface);
})();
