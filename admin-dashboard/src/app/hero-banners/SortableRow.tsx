'use client';

import { Reorder, useDragControls } from 'framer-motion';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';

/**
 * One draggable row in the hero-banner list. Dragging starts only from the
 * grip handle (children receive `startDrag` to wire it up), so clicks on the
 * row's buttons and image never start a drag. Works with mouse and touch.
 */
export default function SortableRow<T>({
    value,
    style,
    onDragStart,
    onDragEnd,
    children,
}: {
    value: T;
    style?: CSSProperties;
    onDragStart?: () => void;
    onDragEnd?: () => void;
    children: (startDrag: (e: PointerEvent) => void) => ReactNode;
}) {
    const controls = useDragControls();
    return (
        <Reorder.Item
            as="div"
            value={value}
            dragListener={false}
            dragControls={controls}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            whileDrag={{ scale: 1.015, boxShadow: '0 12px 32px rgba(0,0,0,0.22)', zIndex: 5 }}
            style={{ position: 'relative', ...style }}
        >
            {children((e) => controls.start(e))}
        </Reorder.Item>
    );
}
