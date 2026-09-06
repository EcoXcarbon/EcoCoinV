import { useState, useMemo } from 'react';
import { useLang } from '../context/LangContext';

export default function DataTable({ columns, data, onRowClick, searchable = true }) {
  const { t } = useLang();
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const perPage = 15;

  const filtered = useMemo(() => {
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter(row =>
      columns.some(col => String(row[col.key] ?? '').toLowerCase().includes(q))
    );
  }, [data, search, columns]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const pages = Math.ceil(sorted.length / perPage);
  const rows = sorted.slice((page - 1) * perPage, page * perPage);

  const handleSort = (key) => {
    if (sortCol === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(key); setSortDir('asc'); }
  };

  return (
    <div>
      {searchable && (
        <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder={`${t('Search')}...`}
          className="mb-4 w-full max-w-sm px-3 py-2 text-sm border border-border dark:border-navy-light rounded-xl bg-white dark:bg-navy-mid dark:text-white focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none" />
      )}
      <div className="overflow-x-auto rounded-xl border border-border dark:border-navy-light">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-navy-light">
              {columns.map(col => (
                <th key={col.key} onClick={() => col.sortable !== false && handleSort(col.key)}
                  className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider ${col.sortable !== false ? 'cursor-pointer hover:text-gray-900 dark:hover:text-white select-none' : ''}`}>
                  {t(col.label)} {sortCol === col.key && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border dark:divide-navy-light">
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">No data found</td></tr>
            ) : rows.map((row, i) => (
              <tr key={row._id || i} onClick={() => onRowClick?.(row)}
                className={`bg-white dark:bg-navy-mid hover:bg-gray-50 dark:hover:bg-navy-light transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}>
                {columns.map(col => (
                  <td key={col.key} className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-xs text-gray-500 dark:text-gray-400">
          <span>Showing {(page - 1) * perPage + 1}-{Math.min(page * perPage, sorted.length)} of {sorted.length}</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg border border-border dark:border-navy-light disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-navy-light">Prev</button>
            <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-border dark:border-navy-light disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-navy-light">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
