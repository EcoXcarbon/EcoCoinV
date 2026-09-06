import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * Ordering question — drag-to-reorder list.
 * question.correctOrder: string[] — correct sequence
 * answer: string[] — user's current order
 */

function SortableItem({ id, index, disabled, showResult, correctOrder }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
  };

  const isInCorrectPosition = showResult && correctOrder && correctOrder[index] === id;
  const isInWrongPosition = showResult && correctOrder && correctOrder[index] !== id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-sm transition-all
        ${isDragging
          ? 'border-ilo-blue bg-ilo-blue/10 dark:bg-ilo-blue/20 shadow-lg scale-[1.02]'
          : showResult
            ? isInCorrectPosition
              ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
              : 'border-red-500 bg-red-50 dark:bg-red-900/20'
            : 'border-border dark:border-navy-light bg-white dark:bg-navy-mid hover:border-ilo-blue/40'
        }
        ${disabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}
      `}
      {...attributes}
      {...listeners}
    >
      {/* Drag handle */}
      <div className="flex flex-col gap-0.5 text-gray-400 dark:text-gray-500 shrink-0">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16" />
        </svg>
      </div>

      {/* Position number */}
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0
        ${showResult
          ? isInCorrectPosition
            ? 'bg-green-500 text-white'
            : 'bg-red-500 text-white'
          : 'bg-gray-200 dark:bg-navy-light text-gray-600 dark:text-gray-400'
        }`}>
        {index + 1}
      </span>

      {/* Item text */}
      <span className={`flex-1 font-medium
        ${showResult
          ? isInCorrectPosition
            ? 'text-green-700 dark:text-green-400'
            : 'text-red-700 dark:text-red-400'
          : 'text-gray-800 dark:text-gray-200'
        }`}>
        {id}
      </span>

      {/* Result indicator */}
      {showResult && (
        <span className={`text-[10px] font-bold shrink-0 ${isInCorrectPosition ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {isInCorrectPosition ? 'Correct' : 'Wrong'}
        </span>
      )}
    </div>
  );
}

export default function OrderingQuestion({ question, answer, onChange, disabled, showResult, isCorrect }) {
  const correctOrder = question.correctOrder || [];

  // Initialize answer with shuffled items if not yet set
  const items = answer || (() => {
    const shuffled = [...correctOrder].sort(() => Math.random() - 0.5);
    setTimeout(() => onChange(shuffled), 0);
    return shuffled;
  })();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.indexOf(active.id);
    const newIndex = items.indexOf(over.id);
    const newOrder = arrayMove(items, oldIndex, newIndex);
    onChange(newOrder);
  };

  return (
    <div>
      {!disabled && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Drag items to arrange them in the correct order.
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {items.map((item, index) => (
              <SortableItem
                key={item}
                id={item}
                index={index}
                disabled={disabled}
                showResult={showResult}
                correctOrder={correctOrder}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Show correct order if wrong */}
      {showResult && !isCorrect && (
        <div className="mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800">
          <p className="text-[10px] font-bold text-green-700 dark:text-green-400 uppercase mb-1">Correct Order</p>
          <div className="space-y-1">
            {correctOrder.map((item, i) => (
              <p key={i} className="text-xs text-green-800 dark:text-green-300">
                <span className="font-bold mr-1">{i + 1}.</span> {item}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
