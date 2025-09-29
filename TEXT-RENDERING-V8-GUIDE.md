# Pixi.js v8+ Text Rendering - Usage Guide

## Problem

Text rendering in Pixi.js v8+ requires proper texture preparation that wasn't needed in earlier versions.

## Solution

Use the `prepareTextForV8()` utility function provided in `L.PixiOverlay.js` v2.0.0-beta.1+.

## Quick Example

```javascript
// Create text with enhanced style for v8+
const textStyle = new PIXI.TextStyle({
    fontFamily: ['Arial', 'sans-serif'],
    fontSize: 32,
    fill: '#FF0000', // Single color for v8+ compatibility
    stroke: '#000000',
    strokeThickness: 4,
    dropShadow: true,
    dropShadowColor: '#000000',
    dropShadowBlur: 4
});

const text = new PIXI.Text('Hello v8+!', textStyle);
text.anchor.set(0.5, 0.5);

const container = new PIXI.Container();
container.addChild(text);

// Draw callback with v8+ text preparation
const drawCallback = function(utils) {
    const centerPoint = utils.latLngToLayerPoint([lat, lng]);
    const scale = utils.getScale();
    const renderer = utils.getRenderer();
    
    // Position and scale text
    text.position.set(centerPoint.x, centerPoint.y);
    text.scale.set(Math.max(0.5, 1 / scale));
    
    // V8+ CRITICAL: Prepare text for rendering
    utils.prepareTextForV8(text);
    
    // Render
    renderer.render(container);
};

// Create overlay
const overlay = L.pixiOverlay(drawCallback, container);
overlay.addTo(map);
```

## Key Points

1. **Always call `utils.prepareTextForV8(textObject)`** before rendering
2. **Use solid colors** like `'#FF0000'` instead of gradient arrays for v8+ compatibility
3. **Add drop shadows** for enhanced readability
4. **Test with `test-text-v8-fixed.html`** for validation

## For Multiple Text Objects

```javascript
const texts = [text1, text2, text3];

const drawCallback = function(utils) {
    texts.forEach(textObj => {
        // Position your text...
        utils.prepareTextForV8(textObj); // Prepare each text
    });
    
    utils.getRenderer().render(container);
};
```

## Files Modified

- `L.PixiOverlay.js` - Added `prepareTextForV8()` utility
- `test-v8-compatibility.html` - Updated text test
- `test-text-v8-fixed.html` - **COMPLETE** merged test suite with 6 comprehensive scenarios

## Compatibility

- ✅ Pixi.js v4-v7: Works normally (prepareTextForV8 is no-op)
- ✅ Pixi.js v8+: Requires prepareTextForV8() call
- ✅ All Leaflet versions supported

---

*Last updated: September 29, 2025*
*Leaflet.PixiOverlay v2.0.0-beta.1*
