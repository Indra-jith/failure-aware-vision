/**
 * scroll-stack.js — Vanilla JS port of the React ScrollStack component.
 * Uses Lenis for smooth scrolling. Window-scroll mode only.
 *
 * Usage:
 *   const stack = new ScrollStack({ ...options });
 *   // Make sure to call stack.destroy() when unmounting.
 */

class ScrollStack {
    /**
     * @param {Object} opts
     * @param {number}  opts.itemDistance      - marginBottom between cards (px). Default 100
     * @param {number}  opts.itemScale         - scale step per card below top. Default 0.03
     * @param {number}  opts.itemStackDistance - vertical offset per stacked card (px). Default 30
     * @param {string}  opts.stackPosition     - top position where cards pin. Default '20%'
     * @param {string}  opts.scaleEndPosition  - scroll position where scale reach target. Default '10%'
     * @param {number}  opts.baseScale         - minimum scale for bottom-most card. Default 0.85
     * @param {number}  opts.rotationAmount    - tilt per card. Default 0
     * @param {number}  opts.blurAmount        - blur (px) per depth level. Default 0
     * @param {Function} opts.onStackComplete  - callback when last card is in stack view
     */
    constructor(opts = {}) {
        this.itemDistance = opts.itemDistance ?? 100;
        this.itemScale = opts.itemScale ?? 0.03;
        this.itemStackDistance = opts.itemStackDistance ?? 30;
        this.stackPosition = opts.stackPosition ?? '20%';
        this.scaleEndPosition = opts.scaleEndPosition ?? '10%';
        this.baseScale = opts.baseScale ?? 0.85;
        this.rotationAmount = opts.rotationAmount ?? 0;
        this.blurAmount = opts.blurAmount ?? 0;
        this.onStackComplete = opts.onStackComplete ?? null;

        this._cards = [];
        this._lastTransforms = new Map();
        this._isUpdating = false;
        this._stackDone = false;
        this._lenis = null;
        this._rafId = null;

        this._onScroll = () => this._updateTransforms();
        this._init();
    }

    // ─── internal helpers ─────────────────────────────────────────────────────

    _pct(value, containerH) {
        if (typeof value === 'string' && value.includes('%')) {
            return (parseFloat(value) / 100) * containerH;
        }
        return parseFloat(value);
    }

    _clampProgress(scrollTop, start, end) {
        if (scrollTop < start) return 0;
        if (scrollTop > end) return 1;
        return (scrollTop - start) / (end - start);
    }

    // Returns the card's top offset relative to document top (like getBoundingClientRect + scrollY).
    _cardTop(card) {
        return card.getBoundingClientRect().top + window.scrollY;
    }

    // ─── initialise ───────────────────────────────────────────────────────────

    _init() {
        this._cards = Array.from(document.querySelectorAll('.scroll-stack-card'));

        this._cards.forEach((card, i) => {
            if (i < this._cards.length - 1) {
                card.style.marginBottom = `${this.itemDistance}px`;
            }
            card.style.willChange = 'transform, filter';
            card.style.transformOrigin = 'top center';
            card.style.backfaceVisibility = 'hidden';
            card.style.transform = 'translateZ(0)';
        });

        this._setupLenis();
        this._updateTransforms();
    }

    // ─── smooth scroll (Lenis) ────────────────────────────────────────────────

    _setupLenis() {
        if (typeof Lenis === 'undefined') {
            console.warn('ScrollStack: Lenis not loaded. Falling back to native scroll.');
            window.addEventListener('scroll', this._onScroll, { passive: true });
            return;
        }

        this._lenis = new Lenis({
            duration: 1.2,
            easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
            smoothWheel: true,
            touchMultiplier: 2,
            wheelMultiplier: 1,
            lerp: 0.1,
            syncTouch: true,
            syncTouchLerp: 0.075,
        });

        this._lenis.on('scroll', this._onScroll);

        const raf = time => {
            this._lenis.raf(time);
            this._rafId = requestAnimationFrame(raf);
        };
        this._rafId = requestAnimationFrame(raf);
    }

    // ─── transform update loop ────────────────────────────────────────────────

    _updateTransforms() {
        if (!this._cards.length || this._isUpdating) return;
        this._isUpdating = true;

        const scrollTop = window.scrollY;
        const containerH = window.innerHeight;
        const stackPosPx = this._pct(this.stackPosition, containerH);
        const scaleEndPosPx = this._pct(this.scaleEndPosition, containerH);

        const endEl = document.querySelector('.scroll-stack-end');
        const endElTop = endEl ? endEl.getBoundingClientRect().top + scrollTop : 0;
        const pinEnd = endElTop - containerH / 2;

        this._cards.forEach((card, i) => {
            const cardTop = this._cardTop(card);
            const trigStart = cardTop - stackPosPx - this.itemStackDistance * i;
            const trigEnd = cardTop - scaleEndPosPx;
            const pinStart = trigStart;

            // Scale: starts at 1 → shrinks toward targetScale as card goes into stack
            const scaleProg = this._clampProgress(scrollTop, trigStart, trigEnd);
            const targetScale = this.baseScale + i * this.itemScale;
            const scale = 1 - scaleProg * (1 - targetScale);

            // Rotation (optional)
            const rotation = this.rotationAmount ? i * this.rotationAmount * scaleProg : 0;

            // Blur (optional): cards deeper in stack blur more
            let blur = 0;
            if (this.blurAmount) {
                let topIdx = 0;
                this._cards.forEach((c, j) => {
                    const jTop = this._cardTop(c);
                    if (scrollTop >= jTop - stackPosPx - this.itemStackDistance * j) topIdx = j;
                });
                if (i < topIdx) blur = Math.max(0, (topIdx - i) * this.blurAmount);
            }

            // Translate: pin the card once its trigStart is reached, release at pinEnd
            let translateY = 0;
            const isPinned = scrollTop >= pinStart && scrollTop <= pinEnd;
            if (isPinned) {
                translateY = scrollTop - cardTop + stackPosPx + this.itemStackDistance * i;
            } else if (scrollTop > pinEnd) {
                translateY = pinEnd - cardTop + stackPosPx + this.itemStackDistance * i;
            }

            // Round to avoid sub-pixel thrash
            const ty = Math.round(translateY * 100) / 100;
            const sc = Math.round(scale * 1000) / 1000;
            const rot = Math.round(rotation * 100) / 100;
            const bl = Math.round(blur * 100) / 100;

            const last = this._lastTransforms.get(i);
            const changed = !last
                || Math.abs(last.ty - ty) > 0.1
                || Math.abs(last.sc - sc) > 0.001
                || Math.abs(last.rot - rot) > 0.1
                || Math.abs(last.bl - bl) > 0.1;

            if (changed) {
                card.style.transform = `translate3d(0, ${ty}px, 0) scale(${sc}) rotate(${rot}deg)`;
                card.style.filter = bl > 0 ? `blur(${bl}px)` : '';
                this._lastTransforms.set(i, { ty, sc, rot, bl });
            }

            // onStackComplete callback
            if (i === this._cards.length - 1) {
                const inView = scrollTop >= pinStart && scrollTop <= pinEnd;
                if (inView && !this._stackDone) {
                    this._stackDone = true;
                    this.onStackComplete?.();
                } else if (!inView && this._stackDone) {
                    this._stackDone = false;
                }
            }
        });

        this._isUpdating = false;
    }

    // ─── cleanup ──────────────────────────────────────────────────────────────

    destroy() {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        if (this._lenis) this._lenis.destroy();
        window.removeEventListener('scroll', this._onScroll);
        this._lastTransforms.clear();
        this._cards = [];
    }
}
