/** Camera motion must follow screen-space drag without leaving a material grip active. */
import { describe, expect, it, vi } from 'vitest'
import { bindGummyTouchSurface, createGummyCameraInput, panGummyOrbit, } from './gummyCameraInput'
import { DEFAULT_GUMMY_ORBIT, gummyCameraMatrices } from './gummyStudyMath'
import type { GummyGrip, GummyOrbit, GummyVec3 } from './gummyStudyMath'

function project(orbit: GummyOrbit, point: number[]) {
  const matrix = new Float32Array(16)
  gummyCameraMatrices(
    orbit,
    1,
    matrix,
    new Float32Array(16),
    new Float32Array(3),
  )
  const clip = [0, 1, 2, 3].map((row) =>
    point.reduce((sum, value, col) => sum + value * matrix[col * 4 + row]!, 0),
  )
  return [200 * (clip[0]! / clip[3]! + 1), 200 * (1 - clip[1]! / clip[3]!)]
}

function pointer(
  id: number,
  x: number,
  y: number,
  details: Partial<PointerEvent> = {},
) {
  return {
    pointerId: id,
    clientX: x,
    clientY: y,
    button: 0,
    preventDefault: vi.fn(),
    ...details,
  } as PointerEvent
}

function harness() {
  const canvas = document.createElement('canvas')
  const captures = new Set<number>()
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 400, 400)
  canvas.setPointerCapture = (id) => {
    captures.add(id)
  }
  canvas.releasePointerCapture = (id) => {
    captures.delete(id)
  }
  canvas.hasPointerCapture = (id) => captures.has(id)
  const orbit: GummyOrbit = { ...DEFAULT_GUMMY_ORBIT }
  const pick = vi.fn(),
    cancelGrip = vi.fn(),
    moveGrip = vi.fn()
  const input = createGummyCameraInput({
    canvas,
    orbit: () => orbit,
    mode: () => 'drag',
    ready: () => true,
    pick,
    cancelGrip,
    moveGrip,
  })
  return { input, orbit, pick, cancelGrip, moveGrip, canvas }
}

describe('gummy camera navigation', () => {
  it('normalizes hover to the canvas rect and only shows the actual grip target after selection', () => {
    const { input, canvas, pick, cancelGrip } = harness()
    canvas.getBoundingClientRect = () => new DOMRect(100, 50, 800, 400)
    const grip: GummyGrip = {
      center: [0, 1, 0],
      target: [1, 1.5, 0.25],
      radius: 0.2,
    }
    const origin: GummyVec3 = [0.1, 1.1, 0]
    input.pointerMove(pointer(1, 300, 150, { pointerType: 'mouse' }))
    expect(input.guide()).toEqual({
      x: 0.25,
      y: 0.25,
      active: false,
      target: undefined,
      origin: undefined,
    })
    expect(pick).not.toHaveBeenCalled()
    input.pointerDown(pointer(1, 300, 150, { pointerType: 'mouse' }))
    expect(input.guide()?.active).toBe(false)
    expect(input.guide(grip, origin)).toEqual({
      x: 0.25,
      y: 0.25,
      active: true,
      target: grip.target,
      origin,
    })
    input.pointerMove(pointer(1, 400, 200, { pointerType: 'mouse' }))
    expect(input.guide(grip, origin)).toMatchObject({
      x: 0.375,
      y: 0.375,
      target: grip.target,
      origin,
    })
    input.pointerEnd(
      pointer(1, 400, 200, { pointerType: 'mouse', type: 'pointerup' }),
    )
    expect(cancelGrip).toHaveBeenCalledOnce()
    expect(input.guide()).toEqual({
      x: 0.375,
      y: 0.375,
      active: false,
      target: undefined,
      origin: undefined,
    })
    input.pointerLeave()
    expect(input.guide()).toBeUndefined()
  })

  it.each(['pointercancel', 'lostpointercapture'])(
    'clears the pointer guide on %s',
    (type) => {
      const { input, canvas } = harness()
      input.pointerDown(pointer(1, 100, 100, { pointerType: 'mouse' }))
      expect(input.guide()).toBeDefined()
      input.pointerEnd(pointer(1, 100, 100, { pointerType: 'mouse', type }))
      expect(input.guide()).toBeUndefined()
      expect(canvas.hasPointerCapture(1)).toBe(false)
    },
  )

  it('clears touch guides on release, a second finger, and explicit cancellation', () => {
    const { input } = harness()
    const touch = { pointerType: 'touch' }
    input.pointerMove(pointer(1, 100, 100, touch))
    expect(input.guide()).toBeUndefined()
    input.pointerDown(pointer(1, 100, 100, touch))
    expect(input.guide()).toBeDefined()
    input.pointerEnd(pointer(1, 100, 100, { ...touch, type: 'pointerup' }))
    expect(input.guide()).toBeUndefined()
    input.pointerDown(pointer(2, 100, 100, touch))
    input.pointerDown(pointer(3, 200, 100, touch))
    expect(input.guide()).toBeUndefined()
    input.pointerEnd(pointer(3, 200, 100, { ...touch, type: 'pointerup' }))
    input.pointerMove(pointer(2, 120, 100, touch))
    expect(input.guide()).toBeUndefined()
    input.cancel()
    input.pointerMove(pointer(4, 150, 100, { pointerType: 'mouse' }))
    expect(input.guide()).toBeDefined()
    input.cancel()
    expect(input.guide()).toBeUndefined()
  })

  it('omits the guide when the canvas has no layout area', () => {
    const { input, canvas } = harness()
    input.pointerMove(pointer(1, 100, 100, { pointerType: 'mouse' }))
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
    expect(input.guide()).toBeUndefined()
  })

  it('keeps a point at the target depth under the pointer through rotated and tilted views', () => {
    for (const theta of [0, Math.PI / 2, -0.9]) {
      const orbit: GummyOrbit = { theta, phi: 1.1, zoom: 1 }
      panGummyOrbit(orbit, 40, 20, 400, 400)
      const [x, y] = project(orbit, [0, 1.32, 0, 1])
      expect(x).toBeCloseTo(240, 4)
      expect(y).toBeCloseTo(220, 4)
    }
  })

  it('scales pan with zoom, responsive fit and the actual CSS viewport height', () => {
    const orbit: GummyOrbit = { theta: 0, phi: Math.PI / 2, zoom: 1 }
    panGummyOrbit(orbit, 40, 0, 400, 400)
    expect(orbit.pan?.[0]).toBeCloseTo(-0.4224978336, 8)
    const farther: GummyOrbit = { theta: 0, phi: Math.PI / 2, zoom: 1.5 }
    panGummyOrbit(farther, 40, 0, 800, 800)
    expect(farther.pan?.[0]).toBeCloseTo(orbit.pan![0] * 0.75, 8)
    const narrow: GummyOrbit = { theta: 0, phi: Math.PI / 2, zoom: 1 }
    panGummyOrbit(narrow, 40, 0, 200, 400)
    expect(narrow.pan?.[0]).toBeCloseTo(orbit.pan![0] * 1.5, 8)
    const laid: GummyOrbit = { theta: 0, phi: Math.PI / 2, zoom: 1 }
    panGummyOrbit(laid, 40, 0, 400, 400, 'crush')
    expect(laid.pan?.[0]).toBeCloseTo((orbit.pan![0] * 4.5) / 5.1, 8)
  })

  it('routes right drag to orbit and middle or Shift drag to pan without picking', () => {
    for (const details of [{ button: 2 }, { button: 1 }, { shiftKey: true }]) {
      const { input, orbit, pick, canvas } = harness()
      input.pointerDown(pointer(1, 100, 100, details))
      input.pointerMove(pointer(1, 120, 110, details))
      if (details.button === 2) {
        expect(orbit.theta).toBeCloseTo(0.04)
        expect(orbit.phi).toBeCloseTo(1.22)
        expect(orbit.pan).toBeUndefined()
      } else expect(orbit.pan).toBeDefined()
      expect(pick).not.toHaveBeenCalled()
      expect(input.pointer(1)).toBeUndefined()
      input.pointerEnd(pointer(1, 120, 110))
      expect(canvas.hasPointerCapture(1)).toBe(false)
    }
  })

  it('releases a grab for two-finger pan and pinch, and never regrabs the remaining finger', () => {
    const { input, orbit, pick, cancelGrip, moveGrip } = harness()
    input.pointerDown(pointer(1, 100, 100, { pointerType: 'touch' }))
    expect(pick).toHaveBeenCalledOnce()
    input.pointerDown(pointer(2, 200, 100, { pointerType: 'touch' }))
    expect(cancelGrip).toHaveBeenCalledOnce()
    expect(input.pointer(1)).toBeUndefined()
    input.pointerMove(pointer(2, 240, 100, { pointerType: 'touch' }))
    expect(orbit.zoom).toBeCloseTo(100 / 140)
    expect(orbit.pan).toBeDefined()
    input.pointerEnd(pointer(2, 240, 100, { pointerType: 'touch' }))
    input.pointerMove(pointer(1, 110, 110, { pointerType: 'touch' }))
    expect(pick).toHaveBeenCalledOnce()
    expect(moveGrip).not.toHaveBeenCalled()
    input.pointerEnd(pointer(1, 110, 110, { pointerType: 'touch' }))
    input.pointerDown(pointer(3, 100, 100, { pointerType: 'touch' }))
    expect(pick).toHaveBeenCalledTimes(2)
  })

  it('cancels an in-flight grip when Shift is pressed during a drag or the wheel zooms', () => {
    const { input, cancelGrip, moveGrip, canvas } = harness()
    input.pointerDown(pointer(1, 100, 100))
    input.pointerMove(pointer(1, 120, 110, { shiftKey: true }))
    expect(cancelGrip).toHaveBeenCalledOnce()
    expect(input.pointer(1)).toBeUndefined()
    expect(moveGrip).not.toHaveBeenCalled()
    input.wheel(new WheelEvent('wheel', { deltaY: -50 }))
    expect(canvas.hasPointerCapture(1)).toBe(false)
    expect(cancelGrip).toHaveBeenCalledTimes(2)
  })
})

describe('gummy native touch surface', () => {
  it('prevents native canvas touch gestures without blocking surrounding touch scrolling', () => {
    const surface = document.createElement('section')
    const canvas = document.createElement('canvas')
    const outside = document.createElement('p')
    surface.append(canvas, outside)
    const dispose = bindGummyTouchSurface(canvas)

    for (const type of ['touchstart', 'touchmove']) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      expect(canvas.dispatchEvent(event)).toBe(false)
      expect(event.defaultPrevented).toBe(true)

      const pageTouch = new Event(type, { bubbles: true, cancelable: true })
      expect(outside.dispatchEvent(pageTouch)).toBe(true)
      expect(pageTouch.defaultPrevented).toBe(false)
    }

    const passiveGesture = new Event('touchmove', { cancelable: false })
    const preventDefault = vi.spyOn(passiveGesture, 'preventDefault')
    canvas.dispatchEvent(passiveGesture)
    expect(preventDefault).not.toHaveBeenCalled()
    dispose()

    for (const type of ['touchstart', 'touchmove']) {
      const event = new Event(type, { cancelable: true })
      expect(canvas.dispatchEvent(event)).toBe(true)
      expect(event.defaultPrevented).toBe(false)
    }
  })

  it('leaves material picking to the pointer route while cancelling native touch defaults', () => {
    const { canvas, input, pick, moveGrip, cancelGrip } = harness()
    const dispose = bindGummyTouchSurface(canvas)
    canvas.addEventListener('pointerdown', input.pointerDown)
    canvas.addEventListener('pointermove', input.pointerMove)
    canvas.addEventListener('pointerup', input.pointerEnd)
    const dispatchPointer = (type: string, x: number) => {
      const event = new Event(type, { cancelable: true })
      Object.assign(event, {
        button: 0,
        pointerId: 7,
        pointerType: 'touch',
        clientX: x,
        clientY: 100,
      })
      canvas.dispatchEvent(event)
    }

    dispatchPointer('pointerdown', 100)
    const nativeStart = new Event('touchstart', { cancelable: true })
    canvas.dispatchEvent(nativeStart)
    expect(nativeStart.defaultPrevented).toBe(true)
    expect(pick).toHaveBeenCalledOnce()
    dispatchPointer('pointermove', 145)
    canvas.dispatchEvent(new Event('touchmove', { cancelable: true }))
    expect(moveGrip).toHaveBeenCalledExactlyOnceWith(145, 100)
    dispatchPointer('pointerup', 145)
    expect(cancelGrip).toHaveBeenCalledOnce()
    expect(canvas.hasPointerCapture(7)).toBe(false)
    dispose()
  })

  it('restores existing inline styles and removes only its own gesture listeners', () => {
    const canvas = document.createElement('canvas')
    // Observe the CSSOM contract: happy-dom omits some Safari-only properties.
    const original = new Map([
      ['touch-action', { value: 'pan-y', priority: 'important' }],
      ['user-select', { value: 'text', priority: '' }],
      ['-webkit-user-select', { value: '', priority: '' }],
      ['-webkit-touch-callout', { value: 'default', priority: 'important' }],
    ])
    vi.spyOn(canvas.style, 'getPropertyValue').mockImplementation(
      (name) => original.get(name)?.value ?? '',
    )
    vi.spyOn(canvas.style, 'getPropertyPriority').mockImplementation(
      (name) => original.get(name)?.priority ?? '',
    )
    const setProperty = vi.spyOn(canvas.style, 'setProperty')
    const removeProperty = vi.spyOn(canvas.style, 'removeProperty')
    const unrelated = vi.fn()
    canvas.addEventListener('touchstart', unrelated)
    const dispose = bindGummyTouchSurface(canvas)
    for (const property of original.keys())
      expect(setProperty).toHaveBeenCalledWith(property, 'none')
    setProperty.mockClear()
    dispose()
    dispose()
    expect(setProperty.mock.calls).toEqual([
      ['touch-action', 'pan-y', 'important'],
      ['user-select', 'text', ''],
      ['-webkit-touch-callout', 'default', 'important'],
    ])
    expect(removeProperty).toHaveBeenCalledExactlyOnceWith(
      '-webkit-user-select',
    )
    const event = new Event('touchstart', { cancelable: true })
    canvas.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(unrelated).toHaveBeenCalledOnce()
  })
})
