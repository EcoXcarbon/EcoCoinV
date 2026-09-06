import { useState } from 'react';
import { DndContext, DragOverlay, closestCenter, PointerSensor, useSensor, useSensors, useDroppable, useDraggable } from '@dnd-kit/core';

/**
 * Drag-and-drop question — drag items from a bank into labeled drop zones.
 * question.dropZones: [{id, label}]
 * question.draggables: [{id, text}]
 * answer: { draggableId: zoneId } — mapping of each draggable to its zone
 */

function DraggableItem({ id, text, disabled, isPlaced }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 }
    : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all select-none
        ${isDragging
          ? 'border-ilo-blue bg-ilo-blue/10 dark:bg-ilo-blue/20 shadow-lg opacity-90'
          : isPlaced
            ? 'border-ilo-blue/40 bg-ilo-blue/5 dark:bg-ilo-blue/10 text-ilo-blue'
            : 'border-border dark:border-navy-light bg-white dark:bg-navy-mid text-gray-700 dark:text-gray-300 hover:border-ilo-blue/40'
        }
        ${disabled ? 'cursor-not-allowed opacity-75' : 'cursor-grab active:cursor-grabbing'}
      `}
      {...attributes}
      {...listeners}
    >
      <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16" />
      </svg>
      {text}
    </div>
  );
}

function DropZone({ id, label, children, showResult, zoneCorrect, disabled }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[80px] rounded-xl border-2 border-dashed p-3 transition-all
        ${showResult
          ? zoneCorrect
            ? 'border-green-500 bg-green-50/50 dark:bg-green-900/10'
            : 'border-red-500 bg-red-50/50 dark:bg-red-900/10'
          : isOver
            ? 'border-ilo-blue bg-ilo-blue/5 dark:bg-ilo-blue/10'
            : 'border-gray-300 dark:border-navy-light bg-gray-50 dark:bg-navy-mid/50'
        }`}
    >
      <p className={`text-[10px] font-bold uppercase tracking-wider mb-2
        ${showResult
          ? zoneCorrect ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          : 'text-gray-400 dark:text-gray-500'
        }`}>
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {children}
      </div>
      {(!children || (Array.isArray(children) && children.length === 0)) && (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">Drop items here</p>
      )}
    </div>
  );
}

export default function DragDropQuestion({ question, answer, onChange, disabled, showResult, isCorrect }) {
  const [activeId, setActiveId] = useState(null);

  const dropZones = question.dropZones || [];
  const draggables = question.draggables || [];
  const placements = answer || {};

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Items not yet placed in any zone
  const bankItems = draggables.filter(d => !placements[d.id]);

  // Items in a given zone
  const getZoneItems = (zoneId) => draggables.filter(d => placements[d.id] === zoneId);

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) {
      // Dropped outside — return to bank
      const next = { ...placements };
      delete next[active.id];
      onChange(next);
      return;
    }

    const targetZone = dropZones.find(z => z.id === over.id);
    if (targetZone) {
      onChange({ ...placements, [active.id]: targetZone.id });
    }
  };

  const activeItem = draggables.find(d => d.id === activeId);

  // Check per-zone correctness for result display
  const isZoneCorrect = (zoneId) => {
    if (!question.correctAnswer) return false;
    const zoneItems = getZoneItems(zoneId);
    const correctItems = draggables.filter(d => question.correctAnswer[d.id] === zoneId);
    if (zoneItems.length !== correctItems.length) return false;
    return zoneItems.every(item => question.correctAnswer[item.id] === zoneId);
  };

  return (
    <div>
      {!disabled && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Drag each item from the bank into the correct zone.
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Item bank */}
        {bankItems.length > 0 && (
          <div className="mb-4 p-3 rounded-xl border border-border dark:border-navy-light bg-gray-50 dark:bg-navy-mid">
            <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Item Bank</p>
            <div className="flex flex-wrap gap-2">
              {bankItems.map(item => (
                <DraggableItem key={item.id} id={item.id} text={item.text} disabled={disabled} />
              ))}
            </div>
          </div>
        )}

        {/* Drop zones */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {dropZones.map(zone => {
            const zoneItems = getZoneItems(zone.id);
            return (
              <DropZone
                key={zone.id}
                id={zone.id}
                label={zone.label}
                showResult={showResult}
                zoneCorrect={showResult && isZoneCorrect(zone.id)}
                disabled={disabled}
              >
                {zoneItems.length > 0
                  ? zoneItems.map(item => (
                      <DraggableItem key={item.id} id={item.id} text={item.text} disabled={disabled} isPlaced />
                    ))
                  : null
                }
              </DropZone>
            );
          })}
        </div>

        {/* Drag overlay for smooth visual feedback */}
        <DragOverlay>
          {activeItem ? (
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-ilo-blue bg-ilo-blue/10 dark:bg-ilo-blue/20 text-sm font-medium shadow-xl text-gray-800 dark:text-white">
              {activeItem.text}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Show correct placements if wrong */}
      {showResult && !isCorrect && question.correctAnswer && (
        <div className="mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800">
          <p className="text-[10px] font-bold text-green-700 dark:text-green-400 uppercase mb-1">Correct Placement</p>
          <div className="space-y-1">
            {draggables.map(d => {
              const correctZone = dropZones.find(z => z.id === question.correctAnswer[d.id]);
              return (
                <p key={d.id} className="text-xs text-green-800 dark:text-green-300">
                  {d.text} <span className="text-green-500 mx-1">&rarr;</span> {correctZone?.label || question.correctAnswer[d.id]}
                </p>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
