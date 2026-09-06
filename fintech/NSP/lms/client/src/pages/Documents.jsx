import { useEffect, useState } from 'react';
import api from '../api/client';
import toast from 'react-hot-toast';

const CATEGORIES = [
  { value: 'cv-resume', label: 'CV / Resume' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'experience-letter', label: 'Experience Letter' },
  { value: 'reference-letter', label: 'Reference Letter' },
  { value: 'identity-doc', label: 'Identity Document' },
  { value: 'training-cert', label: 'Training Certificate' },
  { value: 'safety-card', label: 'Safety Card' },
  { value: 'medical-cert', label: 'Medical Certificate' },
  { value: 'passport', label: 'Passport Copy' },
  { value: 'photo', label: 'Photo' },
  { value: 'work-sample', label: 'Work Sample' },
  { value: 'other', label: 'Other' },
];

export default function Documents() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', category: 'other', file: null });

  useEffect(() => { loadDocs(); }, []);

  const loadDocs = () => {
    setLoading(true);
    api.get('/documents')
      .then(r => setDocs(r.data.documents || []))
      .catch(() => toast.error('Failed to load documents'))
      .finally(() => setLoading(false));
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!form.file) { toast.error('Select a file'); return; }
    if (!form.title.trim()) { toast.error('Title is required'); return; }

    const fd = new FormData();
    fd.append('file', form.file);
    fd.append('title', form.title);
    fd.append('description', form.description);
    fd.append('category', form.category);

    setUploading(true);
    try {
      await api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Document uploaded');
      setShowUpload(false);
      setForm({ title: '', description: '', category: 'other', file: null });
      loadDocs();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally { setUploading(false); }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/documents/${id}`);
      toast.success('Document archived');
      loadDocs();
    } catch { toast.error('Delete failed'); }
  };

  const inputClass = 'w-full px-4 py-2.5 border border-gray-200 dark:border-navy-light rounded-xl text-sm bg-white dark:bg-navy dark:text-white focus:ring-2 focus:ring-ilo-blue/30 focus:border-ilo-blue outline-none';

  const catColors = {
    'cv-resume': 'bg-blue-100 text-blue-700', certificate: 'bg-green-100 text-green-700',
    'experience-letter': 'bg-purple-100 text-purple-700', 'reference-letter': 'bg-indigo-100 text-indigo-700',
    'identity-doc': 'bg-gray-100 text-gray-700', 'training-cert': 'bg-teal-100 text-teal-700',
    'safety-card': 'bg-orange-100 text-orange-700', 'medical-cert': 'bg-red-100 text-red-700',
    passport: 'bg-amber-100 text-amber-700', photo: 'bg-pink-100 text-pink-700',
    'work-sample': 'bg-cyan-100 text-cyan-700', other: 'bg-gray-100 text-gray-500',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold dark:text-white">My Documents</h2>
        <button onClick={() => setShowUpload(!showUpload)}
          className="px-4 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-xl hover:bg-ilo-dark">
          {showUpload ? 'Cancel' : 'Upload Document'}
        </button>
      </div>

      {showUpload && (
        <form onSubmit={handleUpload} className="bg-white dark:bg-navy-mid rounded-xl border border-gray-200 dark:border-navy-light p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Title *</label>
              <input type="text" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={inputClass} placeholder="e.g. NEBOSH Safety Certificate" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Category</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inputClass}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Description</label>
            <input type="text" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className={inputClass} placeholder="Brief description (optional)" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">File * (PDF, JPG, PNG, DOC — max 20MB)</label>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" onChange={e => setForm(p => ({ ...p, file: e.target.files?.[0] || null }))}
              className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-ilo-blue/10 file:text-ilo-blue hover:file:bg-ilo-blue/20" />
          </div>
          <button type="submit" disabled={uploading}
            className="px-6 py-2.5 bg-gradient-to-r from-ilo-blue to-ilo-dark text-white font-semibold rounded-xl hover:shadow-lg disabled:opacity-60">
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full" /></div>
      ) : docs.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-navy-mid rounded-xl border border-gray-200 dark:border-navy-light">
          <p className="text-sm text-gray-500">No documents uploaded yet. Upload certificates, letters, and other portfolio documents.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {docs.map(d => (
            <div key={d._id} className="bg-white dark:bg-navy-mid rounded-xl border border-gray-200 dark:border-navy-light p-4">
              <div className="flex items-start justify-between mb-2">
                <h4 className="text-sm font-bold dark:text-white">{d.title}</h4>
                <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full capitalize ${catColors[d.category] || catColors.other}`}>
                  {d.category.replace(/-/g, ' ')}
                </span>
              </div>
              {d.description && <p className="text-xs text-gray-500 mb-2">{d.description}</p>}
              <p className="text-[10px] text-gray-400">{d.file?.name} — {d.file?.size ? `${(d.file.size / 1024).toFixed(0)} KB` : ''}</p>
              <p className="text-[10px] text-gray-400">Uploaded {new Date(d.createdAt).toLocaleDateString()}</p>
              <div className="flex gap-2 mt-3">
                <a href={`/lms/api${d.file?.url}`} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1 text-[10px] font-semibold bg-ilo-blue/10 text-ilo-blue rounded-lg hover:bg-ilo-blue/20">View</a>
                <button onClick={() => handleDelete(d._id)}
                  className="px-3 py-1 text-[10px] font-semibold bg-red-50 text-red-600 rounded-lg hover:bg-red-100">Archive</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
