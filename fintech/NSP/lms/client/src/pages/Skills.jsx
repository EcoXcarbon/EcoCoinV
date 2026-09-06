import { useState } from 'react';
import { useLang } from '../context/LangContext';

const TAXONOMY = [
  { code: '71', label: 'Building & Related Trades Workers', children: [
    { code: '711', label: 'Building Frame & Related Trades Workers', children: [
      { code: '7112', label: 'Bricklayers & Related Workers (Mason)', nqf: '2-4', cu: 12 },
      { code: '7115', label: 'Carpenters & Joiners', nqf: '2-3', cu: 10 },
    ]},
    { code: '712', label: 'Building Finishers & Related Trades', children: [
      { code: '7126', label: 'Plumbers & Pipe Fitters', nqf: '2-3', cu: 8 },
      { code: '7127', label: 'Air Conditioning & Refrigeration Mechanics', nqf: '3-4', cu: 10 },
      { code: '7131', label: 'Painters & Related Workers', nqf: '1-2', cu: 6 },
    ]},
  ]},
  { code: '72', label: 'Metal, Machinery & Related Trades Workers', children: [
    { code: '721', label: 'Sheet & Structural Metal Workers', children: [
      { code: '7212', label: 'Welders & Flame Cutters', nqf: '2-4', cu: 14 },
      { code: '7214', label: 'Structural Metal Workers (Steel Fixer)', nqf: '2-3', cu: 10 },
    ]},
  ]},
  { code: '74', label: 'Electrical & Electronic Trades Workers', children: [
    { code: '741', label: 'Electrical Equipment Installers', children: [
      { code: '7411', label: 'Building & Related Electricians', nqf: '2-4', cu: 16 },
    ]},
  ]},
];

function TreeNode({ node, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children?.length > 0;
  const isLeaf = !hasChildren;

  return (
    <div>
      <div onClick={() => hasChildren && setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${hasChildren ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-navy-light font-semibold' : 'ml-4'}`}
        style={{ paddingLeft: `${depth * 20 + 12}px` }}>
        {hasChildren && <span className={`text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>}
        <span className="text-ilo-blue font-mono text-xs">{node.code}</span>
        <span className="dark:text-gray-200">{node.label}</span>
        {isLeaf && (
          <span className="ml-auto flex gap-2">
            <span className="text-xs bg-ilo-blue/10 text-ilo-blue px-2 py-0.5 rounded-full font-medium">NQF {node.nqf}</span>
            <span className="text-xs bg-gold-light/10 text-gold-light px-2 py-0.5 rounded-full font-medium">{node.cu} CUs</span>
          </span>
        )}
      </div>
      {hasChildren && open && (
        <div>
          {node.children.map(child => <TreeNode key={child.code} node={child} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

export default function Skills() {
  const { t } = useLang();

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold dark:text-white">{t('Skills')} & Competencies</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">ISCO-08 Construction Trades Taxonomy — Pakistan NQF aligned</p>

      <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-4">
        {TAXONOMY.map(node => <TreeNode key={node.code} node={node} />)}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        {[{ level: 1, label: 'Helper', desc: 'Basic tasks under supervision' },
          { level: 2, label: 'Semi-Skilled', desc: 'Routine tasks independently' },
          { level: 3, label: 'Skilled', desc: 'Complex tasks, supervise others' },
          { level: 4, label: 'Master Craftsperson', desc: 'Specialist, mentor, quality assurance' },
        ].map(n => (
          <div key={n.level} className="bg-white dark:bg-navy-mid border border-border dark:border-navy-light rounded-xl p-4 text-center">
            <div className="w-10 h-10 rounded-full bg-ilo-blue/10 dark:bg-ilo-blue/20 mx-auto flex items-center justify-center text-ilo-blue font-bold text-lg mb-2">{n.level}</div>
            <h4 className="text-sm font-bold dark:text-white">{n.label}</h4>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{n.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
