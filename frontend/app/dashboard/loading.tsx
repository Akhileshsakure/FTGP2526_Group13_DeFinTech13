// app/loading.tsx
// Next.js automatically shows this while app/page.tsx is loading
export default function DashboardLoading() {
  return (
    <div className="fade-up">
      <div className="mb-8">
        <div className="skeleton h-9 w-40 mb-2 rounded" />
        <div className="skeleton h-4 w-64 rounded" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card p-4">
            <div className="skeleton h-3 w-20 mb-3 rounded" />
            <div className="skeleton h-7 w-24 rounded" />
          </div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-100">
          <div className="skeleton h-4 w-28 rounded" />
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-5 py-4 flex items-center gap-4 border-b border-stone-50">
            <div className="skeleton w-8 h-8 rounded-full" />
            <div className="flex-1">
              <div className="skeleton h-3.5 w-16 mb-2 rounded" />
              <div className="skeleton h-3 w-24 rounded" />
            </div>
            <div className="skeleton h-5 w-28 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
