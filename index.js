// -----------------------------------------------------------------------------
// ClickTone - stereowidener
// Custom UI Native View Bridge for Amorph v2
// -----------------------------------------------------------------------------

const PARAM_WIDTH = 'param1';
const PARAM_LOW_CUT = 'param2';
const PARAM_MONO = 'param3';

const WIDTH_MIN = 0;
const WIDTH_MAX = 1;
const WIDTH_DEFAULT = 0.5;

const CUT_MIN = 20;
const CUT_MAX = 500;
const CUT_DEFAULT = 100;

const ARC_CIRCUMFERENCE = 2 * Math.PI * 44;
const ARC_SPAN = ARC_CIRCUMFERENCE * 0.75;
const KNOB_START_ANGLE = -135;
const KNOB_ANGLE_RANGE = 270;

function clamp(value, min, max)
{
    return Math.max(min, Math.min(max, value));
}

// Erzeugt das halbkreisförmige Stereofeld. Je größer die Weite, desto weiter
// öffnet sich die Neon-Fläche nach links und rechts.
function buildStereoFieldPath(norm)
{
    const cx = 150;
    const baseY = 108;
    const topY = 42;
    const spread = 22 + clamp(norm, 0, 1) * 106;

    const leftCtrlX = cx - spread * 0.58;
    const rightCtrlX = cx + spread * 0.58;
    const leftTopX = cx - spread;
    const rightTopX = cx + spread;

    return [
        `M ${cx},${baseY}`,
        `C ${leftCtrlX},${baseY - 24} ${cx - spread * 0.92},${topY + 18} ${leftTopX},${topY}`,
        `Q ${cx},${topY + 26} ${rightTopX},${topY}`,
        `C ${cx + spread * 0.92},${topY + 18} ${rightCtrlX},${baseY - 24} ${cx},${baseY}`,
        'Z'
    ].join(' ');
}

class StereoWidenerView
{
    constructor(patchConnection)
    {
        this.patchConnection = patchConnection;

        this.state = {
            width: WIDTH_DEFAULT,
            lowCut: CUT_DEFAULT,
            mono: false
        };

        this.meterRaf = null;
        this.paramListener = null;
        this._defaultsEnforced = false;

        this.element = document.createElement('div');
        this.element.className = 'stereowidener-host';
        this.element.innerHTML = this._getMarkup();

        this._cacheElements();
        this._bindEvents();
        this._bindParameters();
        this._renderAll();
        this._enforceDefaults();
        this._startMeterLoop();
    }

    _getMarkup()
    {
        return `
<style>
    .stereowidener-host {
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background:
            radial-gradient(circle at 50% 0%, rgba(0, 229, 255, 0.06), transparent 52%),
            #0e1014;
        font-family: 'Helvetica Neue', Arial, sans-serif;
        color: #eceff1;
        user-select: none;
        overflow: hidden;
    }

    .stereowidener-host *,
    .stereowidener-host *::before,
    .stereowidener-host *::after {
        box-sizing: border-box;
    }

    .plugin-container {
        position: relative;
        width: 680px;
        height: 440px;
        max-width: 100%;
        max-height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #2c323f;
        border-radius: 10px;
        background:
            linear-gradient(145deg, rgba(255, 255, 255, 0.035), transparent 28%),
            linear-gradient(145deg, #171b22, #101216);
        box-shadow:
            0 24px 60px rgba(0, 0, 0, 0.65),
            inset 0 1px 0 rgba(255, 255, 255, 0.045);
    }

    /* ---------------------------------------------------------------- Header */
    .plugin-header {
        flex: 0 0 44px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 20px;
        background: linear-gradient(180deg, rgba(9, 11, 15, 0.94), rgba(13, 16, 21, 0.72));
        border-bottom: 1px solid #222733;
    }

    .brand-title {
        display: flex;
        align-items: baseline;
        font-size: 14px;
        font-weight: 300;
        letter-spacing: 2.4px;
        color: #707a8a;
    }

    .brand-title strong {
        margin-left: 7px;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 1.2px;
        color: #eceff1;
    }

    .window-controls {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .win-btn {
        width: 12px;
        height: 12px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: #333842;
        cursor: pointer;
        transition: background 0.18s ease, box-shadow 0.18s ease;
    }

    .win-btn.minimize:hover {
        background: #5b6474;
        box-shadow: 0 0 7px rgba(180, 195, 215, 0.4);
    }

    .win-btn.power {
        background: #c62828;
        box-shadow: 0 0 7px rgba(239, 83, 80, 0.65);
    }

    .win-btn.power:hover {
        background: #ef5350;
        box-shadow: 0 0 11px rgba(239, 83, 80, 0.9);
    }

    /* ----------------------------------------------------------- Hauptbereich */
    .main-display {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 12px 22px 8px;
    }

    .center-zone {
        flex: 1 1 auto;
        min-width: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
    }

    /* ------------------------------------------------------ Stereovisualizer */
    .visualizer-svg {
        width: min(310px, 100%);
        height: 110px;
        overflow: visible;
    }

    #stereo-field {
        transition: d 0.12s ease-out, opacity 0.12s ease-out;
    }

    /* -------------------------------------------------------------- Main Knob */
    .knob-area {
        position: relative;
        width: 132px;
        height: 132px;
        flex: 0 0 auto;
    }

    .main-knob-wrapper {
        position: absolute;
        inset: 0;
    }

    .knob-outer-ring {
        width: 100%;
        height: 100%;
        /* SVG-Kreis-Stroke startet bei 3-Uhr; +135deg dreht den Startpunkt
           auf 7:30 (unten links) = Position 0 % des Reglers. */
        transform: rotate(135deg);
        overflow: visible;
    }

    #width-arc {
        filter: drop-shadow(0 0 4px rgba(0, 229, 255, 0.85));
        transition: stroke-dasharray 0.08s linear;
    }

    .metallic-knob {
        position: absolute;
        top: 15px;
        left: 15px;
        width: 102px;
        height: 102px;
        border-radius: 50%;
        cursor: ns-resize;
        touch-action: none;
        background:
            radial-gradient(circle at 34% 27%, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.04) 28%, transparent 46%),
            radial-gradient(circle at 50% 60%, #424a57 0%, #262c35 56%, #111318 100%);
        border: 1px solid #4a5360;
        box-shadow:
            inset 0 2px 3px rgba(255, 255, 255, 0.23),
            inset 0 -5px 9px rgba(0, 0, 0, 0.55),
            0 10px 18px rgba(0, 0, 0, 0.55);
    }

    .metallic-knob::after {
        content: '';
        position: absolute;
        inset: 17px;
        border-radius: 50%;
        background: radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0.18), transparent 70%);
        pointer-events: none;
    }

    .metallic-knob.dragging {
        box-shadow:
            inset 0 2px 3px rgba(255, 255, 255, 0.23),
            inset 0 -5px 9px rgba(0, 0, 0, 0.55),
            0 10px 18px rgba(0, 0, 0, 0.55),
            0 0 18px rgba(0, 229, 255, 0.15);
    }

    .knob-pointer {
        position: absolute;
        top: 9px;
        left: 49px;
        width: 4px;
        height: 22px;
        border-radius: 2px;
        background: #00e5ff;
        box-shadow: 0 0 9px rgba(0, 229, 255, 0.95);
        transform-origin: 2px 42px;
        transition: transform 0.05s linear;
        pointer-events: none;
    }

    .arc-label {
        position: absolute;
        bottom: 2px;
        font-family: monospace;
        font-size: 9px;
        letter-spacing: 0.5px;
        color: #6b7686;
        pointer-events: none;
    }

    .arc-label.left {
        left: -9px;
    }

    .arc-label.right {
        right: -13px;
    }

    .digital-value {
        display: flex;
        align-items: baseline;
        justify-content: center;
        gap: 2px;
        height: 22px;
        font-family: monospace;
        font-size: 19px;
        line-height: 22px;
        color: #00e5ff;
        text-shadow: 0 0 11px rgba(0, 229, 255, 0.45);
    }

    .digital-value .unit {
        font-size: 11px;
        color: #6fd9e8;
    }

    /* ------------------------------------------------------------- Level Meter */
    .meter-panel {
        flex: 0 0 auto;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
    }

    .meter-title {
        font-size: 8px;
        letter-spacing: 2px;
        color: #5d6675;
    }

    .meter-container {
        width: 50px;
        height: 214px;
        display: flex;
        gap: 5px;
        padding: 5px;
        border: 1px solid #252b35;
        border-radius: 5px;
        background: #0a0c0f;
        box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.8);
    }

    .meter-bar-track {
        position: relative;
        flex: 1;
        display: flex;
        flex-direction: column-reverse;
        overflow: hidden;
        border-radius: 2px;
        background: linear-gradient(to top, #14191f, #0c0f13);
    }

    .meter-bar-track::after {
        content: '';
        position: absolute;
        inset: 0;
        background: repeating-linear-gradient(
            to top,
            transparent 0,
            transparent 5px,
            rgba(0, 0, 0, 0.55) 5px,
            rgba(0, 0, 0, 0.55) 6px
        );
        pointer-events: none;
    }

    .meter-fill {
        width: 100%;
        height: 30%;
        border-radius: 2px 2px 0 0;
        background: linear-gradient(to top, #00c8ff, #00e5ff 55%, #46ffd2 78%, #ff9a2e);
        box-shadow: 0 0 7px rgba(0, 229, 255, 0.55);
        transition: height 0.07s linear;
    }

    .meter-labels {
        display: flex;
        justify-content: space-between;
        width: 50px;
        padding: 0 8px;
        font-family: monospace;
        font-size: 9px;
        color: #6b7686;
    }

    /* --------------------------------------------------------- Unterer Bereich */
    .bottom-controls {
        flex: 0 0 104px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        padding: 0 34px;
        border-top: 1px solid #222733;
        background:
            linear-gradient(180deg, rgba(22, 26, 33, 0.85), rgba(12, 15, 19, 0.96));
    }

    .sub-knob-section {
        display: flex;
        align-items: center;
        gap: 16px;
    }

    .cut-knob-area {
        position: relative;
        width: 82px;
        height: 100px;
        flex: 0 0 auto;
    }

    .small-knob-wrapper {
        position: absolute;
        top: 0;
        left: 5px;
        width: 72px;
        height: 72px;
    }

    .small-knob-ring {
        width: 100%;
        height: 100%;
        /* Wie oben: Stroke-Start auf 7:30 (= 20 Hz) drehen. */
        transform: rotate(135deg);
        overflow: visible;
    }

    #cut-arc {
        filter: drop-shadow(0 0 4px rgba(255, 109, 0, 0.8));
        transition: stroke-dasharray 0.08s linear;
    }

    .small-knob {
        position: absolute;
        top: 11px;
        left: 11px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        cursor: ns-resize;
        touch-action: none;
        background:
            radial-gradient(circle at 35% 28%, rgba(255, 255, 255, 0.22), transparent 40%),
            radial-gradient(circle at 50% 60%, #3c434e 0%, #1c2027 62%, #101216 100%);
        border: 1px solid #3a424e;
        box-shadow:
            inset 0 1px 2px rgba(255, 255, 255, 0.2),
            0 6px 10px rgba(0, 0, 0, 0.5);
    }

    .small-pointer {
        position: absolute;
        top: 4px;
        left: 23px;
        width: 3px;
        height: 11px;
        border-radius: 1.5px;
        background: #ff6d00;
        box-shadow: 0 0 7px rgba(255, 109, 0, 0.9);
        transform-origin: 1.5px 21px;
        transition: transform 0.05s linear;
        pointer-events: none;
    }

    .cut-scale {
        position: absolute;
        top: 69px;
        left: 0;
        right: 0;
        display: flex;
        justify-content: space-between;
        font-family: monospace;
        font-size: 8px;
        color: #6b7686;
        pointer-events: none;
    }

    .cut-readout {
        position: absolute;
        top: 81px;
        left: 0;
        right: 0;
        height: 18px;
        line-height: 16px;
        text-align: center;
        font-family: monospace;
        font-size: 11px;
        color: #ff7a18;
        background: #0d0f13;
        border: 1px solid #34291f;
        border-radius: 3px;
        text-shadow: 0 0 7px rgba(255, 109, 0, 0.3);
        pointer-events: none;
    }

    .control-label {
        font-size: 10px;
        line-height: 1.35;
        letter-spacing: 1.3px;
        text-transform: uppercase;
        color: #707a8a;
    }

    /* ------------------------------------------------------------ Mono Check */
    .mono-btn {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 154px;
        height: 56px;
        padding: 0 14px;
        border: 1px solid #2b3a34;
        border-radius: 6px;
        background: linear-gradient(180deg, #1b211f, #111614);
        color: #77817f;
        cursor: pointer;
        transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, color 0.2s ease;
    }

    .mono-btn:hover {
        border-color: #3a5248;
        color: #9aa5a2;
    }

    .mono-btn.active {
        border-color: #00e676;
        background: linear-gradient(180deg, rgba(0, 230, 118, 0.16), rgba(0, 230, 118, 0.055));
        color: #00e676;
        box-shadow:
            inset 0 0 12px rgba(0, 230, 118, 0.14),
            0 0 15px rgba(0, 230, 118, 0.16);
    }

    .mono-logo {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        flex: 0 0 auto;
        border: 1px solid #33443c;
        border-radius: 50%;
        font-family: monospace;
        font-size: 16px;
        font-weight: 700;
        color: #6c7773;
        transition: all 0.2s ease;
    }

    .mono-btn.active .mono-logo {
        border-color: #00e676;
        color: #00e676;
        text-shadow: 0 0 9px rgba(0, 230, 118, 0.8);
        box-shadow: 0 0 10px rgba(0, 230, 118, 0.28);
    }

    .mono-copy {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 1px;
        line-height: 1.1;
    }

    .mono-copy .mono-main {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 1.2px;
        text-transform: uppercase;
    }

    .mono-copy .mono-sub {
        font-size: 7px;
        letter-spacing: 1px;
        text-transform: uppercase;
        opacity: 0.62;
    }

    .mono-led {
        width: 8px;
        height: 8px;
        margin-left: auto;
        border-radius: 50%;
        background: #25332c;
        border: 1px solid #33443c;
        transition: all 0.2s ease;
    }

    .mono-btn.active .mono-led {
        background: #00e676;
        border-color: #7affbd;
        box-shadow: 0 0 9px rgba(0, 230, 118, 0.95);
    }
</style>

<div class="plugin-container">
    <div class="plugin-header">
        <div class="brand-title">ClickTone<strong>stereowidener</strong></div>
        <div class="window-controls">
            <button class="win-btn minimize" type="button" title="Minimize" aria-label="Minimize"></button>
            <button class="win-btn power" type="button" title="Power" aria-label="Power"></button>
        </div>
    </div>

    <div class="main-display">
        <div class="center-zone">
            <svg class="visualizer-svg" viewBox="0 0 300 120" aria-label="Stereo field">
                <defs>
                    <linearGradient id="neon-grad" x1="0%" y1="100%" x2="0%" y2="0%">
                        <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.16"/>
                        <stop offset="52%" stop-color="#00e5ff" stop-opacity="0.44"/>
                        <stop offset="100%" stop-color="#7af8ff" stop-opacity="0.78"/>
                    </linearGradient>
                    <filter id="neon-glow" x="-60%" y="-60%" width="220%" height="220%">
                        <feGaussianBlur stdDeviation="3.2" result="blur"/>
                        <feMerge>
                            <feMergeNode in="blur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                </defs>

                <path d="M150,110 L22,36 M150,110 L278,36 M150,110 L150,12"
                      stroke="#1d2530" stroke-width="1.4" stroke-dasharray="4 5" fill="none"/>
                <path d="M150,110 L92,50 M150,110 L208,50"
                      stroke="#1a222c" stroke-width="1" fill="none"/>

                <text x="14" y="28" fill="#66717f" font-size="11" font-family="monospace">L</text>
                <text x="276" y="28" fill="#66717f" font-size="11" font-family="monospace">R</text>

                <path id="stereo-field"
                      d="M 150,108 C 137,84 128,60 128,42 Q 150,68 172,42 C 172,60 163,84 150,108 Z"
                      fill="url(#neon-grad)"
                      stroke="rgba(0, 229, 255, 0.85)"
                      stroke-width="1.1"
                      filter="url(#neon-glow)"/>

                <circle cx="150" cy="109" r="2.6" fill="#00e5ff" filter="url(#neon-glow)"/>
            </svg>

            <div class="knob-area">
                <div class="main-knob-wrapper">
                    <svg class="knob-outer-ring" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="44"
                                stroke="#232936" stroke-width="4" fill="none"/>
                        <circle id="width-arc" cx="50" cy="50" r="44"
                                stroke="#00e5ff" stroke-width="4" fill="none"
                                stroke-linecap="round"/>
                    </svg>
                    <div class="metallic-knob" id="width-knob" role="slider"
                         aria-label="Stereo width" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
                        <div class="knob-pointer" id="width-pointer"></div>
                    </div>
                </div>
                <span class="arc-label left">0%</span>
                <span class="arc-label right">100%</span>
            </div>

            <div class="digital-value">
                <span id="width-value">50</span><span class="unit">%</span>
            </div>
        </div>

        <div class="meter-panel">
            <div class="meter-title">OUTPUT</div>
            <div class="meter-container">
                <div class="meter-bar-track"><div class="meter-fill" id="meter-l"></div></div>
                <div class="meter-bar-track"><div class="meter-fill" id="meter-r"></div></div>
            </div>
            <div class="meter-labels"><span>L</span><span>R</span></div>
        </div>
    </div>

    <div class="bottom-controls">
        <div class="sub-knob-section">
            <div class="cut-knob-area">
                <div class="small-knob-wrapper">
                    <svg class="small-knob-ring" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="44"
                                stroke="#292d34" stroke-width="5" fill="none"/>
                        <circle id="cut-arc" cx="50" cy="50" r="44"
                                stroke="#ff6d00" stroke-width="5" fill="none"
                                stroke-linecap="round"/>
                    </svg>
                    <div class="small-knob" id="cut-knob" role="slider"
                         aria-label="Low frequency cut" aria-valuemin="20" aria-valuemax="500" aria-valuenow="100">
                        <div class="small-pointer" id="cut-pointer"></div>
                    </div>
                </div>
                <div class="cut-scale"><span>20Hz</span><span>500Hz</span></div>
                <div class="cut-readout" id="cut-value">100 Hz</div>
            </div>

            <div class="control-label">
                Low Frequency Cut
            </div>
        </div>

        <button class="mono-btn" id="mono-btn" type="button" aria-pressed="false">
            <span class="mono-logo">M</span>
            <span class="mono-copy">
                <span class="mono-main">Mono Check</span>
                <span class="mono-sub">Compatibility</span>
            </span>
            <span class="mono-led"></span>
        </button>
    </div>
</div>`;
    }

    _cacheElements()
    {
        const root = this.element;

        this.widthKnob = root.querySelector('#width-knob');
        this.widthPointer = root.querySelector('#width-pointer');
        this.widthArc = root.querySelector('#width-arc');
        this.widthValue = root.querySelector('#width-value');

        this.stereoField = root.querySelector('#stereo-field');

        this.cutKnob = root.querySelector('#cut-knob');
        this.cutPointer = root.querySelector('#cut-pointer');
        this.cutArc = root.querySelector('#cut-arc');
        this.cutValue = root.querySelector('#cut-value');

        this.monoBtn = root.querySelector('#mono-btn');

        this.meterL = root.querySelector('#meter-l');
        this.meterR = root.querySelector('#meter-r');
    }

    _bindEvents()
    {
        this._bindKnob(
            this.widthKnob,
            () => this.state.width,
            (norm) => this.setWidth(norm, true),
            0.0065
        );

        this._bindKnob(
            this.cutKnob,
            () => (this.state.lowCut - CUT_MIN) / (CUT_MAX - CUT_MIN),
            (norm) => this.setLowCut(CUT_MIN + norm * (CUT_MAX - CUT_MIN), true),
            0.0045
        );

        this.widthKnob.addEventListener('dblclick', () => this.setWidth(WIDTH_DEFAULT, true));
        this.cutKnob.addEventListener('dblclick', () => this.setLowCut(CUT_DEFAULT, true));
        this.monoBtn.addEventListener('click', () => this.setMono(!this.state.mono, true));
    }

    _bindKnob(knob, getNorm, setNorm, sensitivity)
    {
        let drag = null;

        const finishDrag = (event) =>
        {
            if (!drag || event.pointerId !== drag.pointerId) return;
            drag = null;
            knob.classList.remove('dragging');
            try
            {
                if (knob.hasPointerCapture(event.pointerId))
                    knob.releasePointerCapture(event.pointerId);
            }
            catch (_) { /* Pointer war bereits freigegeben. */ }
        };

        knob.addEventListener('pointerdown', (event) =>
        {
            if (event.button !== 0) return;
            event.preventDefault();
            knob.focus();

            drag = {
                pointerId: event.pointerId,
                startY: event.clientY,
                startNorm: clamp(getNorm(), 0, 1)
            };

            knob.classList.add('dragging');
            try { knob.setPointerCapture(event.pointerId); } catch (_) {}
        });

        knob.addEventListener('pointermove', (event) =>
        {
            if (!drag || event.pointerId !== drag.pointerId) return;
            event.preventDefault();

            const delta = (drag.startY - event.clientY) * sensitivity;
            setNorm(clamp(drag.startNorm + delta, 0, 1));
        });

        knob.addEventListener('pointerup', finishDrag);
        knob.addEventListener('pointercancel', finishDrag);
        knob.addEventListener('lostpointercapture', (event) =>
        {
            if (drag && event.pointerId === drag.pointerId)
            {
                drag = null;
                knob.classList.remove('dragging');
            }
        });

        knob.addEventListener('wheel', (event) =>
        {
            event.preventDefault();
            const direction = event.deltaY > 0 ? -1 : 1;
            setNorm(clamp(getNorm() + direction * 0.02, 0, 1));
        }, { passive: false });

        knob.addEventListener('dragstart', (event) => event.preventDefault());
        knob.addEventListener('contextmenu', (event) => event.preventDefault());
    }

    _bindParameters()
    {
        const connection = this.patchConnection;
        if (!connection) return;

        this.paramListener = (event) =>
        {
            if (!event) return;

            const id = event.endpointID || event.param || event.parameterID;
            const value = Number(event.value);
            if (!id || !Number.isFinite(value)) return;

            if (id === PARAM_WIDTH)
            {
                this.setWidth(value, false);
                if (!this._defaultsEnforced) this._enforceDefaults();
            }
            else if (id === PARAM_LOW_CUT)
            {
                this.setLowCut(value, false);
                if (!this._defaultsEnforced) this._enforceDefaults();
            }
            else if (id === PARAM_MONO)
            {
                this.setMono(value > 0.5, false);
                if (!this._defaultsEnforced) this._enforceDefaults();
            }
        };

        if (connection.addAllParameterListener)
            connection.addAllParameterListener(this.paramListener);

        // Aktuelle DSP-Werte abholen, damit die UI nie mit veralteten
        // Default-Werten startet.
        for (const id of [PARAM_WIDTH, PARAM_LOW_CUT, PARAM_MONO])
        {
            if (connection.requestParameterValue)
                connection.requestParameterValue(id);
        }
    }

    _enforceDefaults()
    {
        if (this._defaultsEnforced) return;
        this._defaultsEnforced = true;

        this.setWidth(WIDTH_DEFAULT, true);
        this.setLowCut(CUT_DEFAULT, true);
        this.setMono(false, true);

        // Noch einmal nach kurzer Verzögerung erzwingen (gegen Session-Caches)
        window.setTimeout(() => {
            if (!this._defaultsEnforced) return;
            this.setWidth(WIDTH_DEFAULT, true);
            this.setLowCut(CUT_DEFAULT, true);
            this.setMono(false, true);
        }, 50);
    }

    _send(id, value)
    {
        if (!this.patchConnection || !this.patchConnection.sendEventOrValue) return;

        try
        {
            this.patchConnection.sendEventOrValue(id, value);
        }
        catch (_) { /* Host kann während des Reloads kurz nicht erreichbar sein. */ }
    }

    setWidth(value, notify)
    {
        const width = clamp(Number(value), WIDTH_MIN, WIDTH_MAX);
        if (!Number.isFinite(width)) return;

        this.state.width = width;
        this._renderWidth();

        if (notify === true)
            this._send(PARAM_WIDTH, width);
    }

    setLowCut(value, notify)
    {
        const hz = clamp(Number(value), CUT_MIN, CUT_MAX);
        if (!Number.isFinite(hz)) return;

        this.state.lowCut = hz;
        this._renderLowCut();

        if (notify === true)
            this._send(PARAM_LOW_CUT, hz);
    }

    setMono(active, notify)
    {
        this.state.mono = !!active;
        this._renderMono();

        if (notify === true)
            this._send(PARAM_MONO, this.state.mono ? 1 : 0);
    }

    _renderAll()
    {
        this._renderWidth();
        this._renderLowCut();
        this._renderMono();
    }

    _renderWidth()
    {
        const norm = clamp(this.state.width, 0, 1);
        const angle = KNOB_START_ANGLE + norm * KNOB_ANGLE_RANGE;

        this.widthPointer.style.transform = `rotate(${angle}deg)`;
        this.widthKnob.setAttribute('aria-valuenow', String(Math.round(norm * 100)));

        // Bogenlänge = norm * Gesamtspannweite. Der Bogen startet an der
        // festen 0-Position (7:30, durch rotate(135deg) gesetzt) und
        // verläuft bis zum aktuellen Wert. Die Lücke = volle
        // Umfangslänge, damit kein zweiter Bogenabschnitt entsteht.
        // Bei 0 wird der Bogen ausgeblendet, da ein Null-Dash mit
        // round-Cap sonst als Punkt gerendert würde.
        this.widthArc.style.strokeDasharray = `${ARC_SPAN * norm} ${ARC_CIRCUMFERENCE}`;
        this.widthArc.style.opacity = norm <= 0 ? '0' : '1';

        this.widthValue.textContent = String(Math.round(norm * 100));

        if (this.stereoField)
        {
            this.stereoField.setAttribute('d', buildStereoFieldPath(norm));
            this.stereoField.style.opacity = String(0.38 + norm * 0.58);
        }
    }

    _renderLowCut()
    {
        const hz = clamp(this.state.lowCut, CUT_MIN, CUT_MAX);
        const norm = (hz - CUT_MIN) / (CUT_MAX - CUT_MIN);
        const angle = KNOB_START_ANGLE + norm * KNOB_ANGLE_RANGE;

        this.cutPointer.style.transform = `rotate(${angle}deg)`;
        this.cutKnob.setAttribute('aria-valuenow', String(Math.round(hz)));

        // Wie beim Width-Arc: Bogen läuft von 20 Hz (7:30) bis zum
        // aktuellen Wert. Bei 0 ausblenden (s. o.).
        this.cutArc.style.strokeDasharray = `${ARC_SPAN * norm} ${ARC_CIRCUMFERENCE}`;
        this.cutArc.style.opacity = norm <= 0 ? '0' : '1';

        this.cutValue.textContent = `${Math.round(hz)} Hz`;
    }

    _renderMono()
    {
        const active = this.state.mono;

        this.monoBtn.classList.toggle('active', active);
        this.monoBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    _startMeterLoop()
    {
        const toNormalized = (value) =>
        {
            const amplitude = Number(value);
            if (!Number.isFinite(amplitude) || amplitude <= 0.00001) return 0;
            const db = 20 * Math.log10(amplitude);
            return clamp((db + 60) / 60, 0, 1);
        };

        let detachedFrames = 0;

        const tick = () =>
        {
            const levels = window.__amorphRmsLevels;

            if (this.element.isConnected)
            {
                detachedFrames = 0;
            }
            else if (++detachedFrames > 120)
            {
                // UI wurde geschlossen: Loop nach kurzer Schonfrist beenden.
                this.meterRaf = null;
                return;
            }

            if (this.element.isConnected && levels)
            {
                const left = levels.outL !== undefined ? levels.outL : levels.inL;
                const right = levels.outR !== undefined ? levels.outR : levels.inR;

                this.meterL.style.height = `${(toNormalized(left) * 100).toFixed(1)}%`;
                this.meterR.style.height = `${(toNormalized(right) * 100).toFixed(1)}%`;
            }

            this.meterRaf = window.requestAnimationFrame(tick);
        };

        this.meterRaf = window.requestAnimationFrame(tick);
    }

    destroy()
    {
        if (this.meterRaf !== null)
        {
            window.cancelAnimationFrame(this.meterRaf);
            this.meterRaf = null;
        }

        if (this.paramListener && this.patchConnection && this.patchConnection.removeAllParameterListener)
            this.patchConnection.removeAllParameterListener(this.paramListener);

        this.paramListener = null;
    }
}

// Amorph v2 Custom-View Contract: default export erhält die PatchConnection
// und liefert das fertig verdrahtete DOM-Element zurück.
export default function createPatchView(patchConnection)
{
    const view = new StereoWidenerView(patchConnection);
    view.element.__stereoWidenerView = view;
    return view.element;
}
