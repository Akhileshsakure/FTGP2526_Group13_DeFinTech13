// app/supply/loading.tsx
export default function SupplyLoading() {
  return (
    <div className="fade-up max-w-xl mx-auto">
      <div className="mb-6">
        <div className="skeleton h-9 w-24 mb-2 rounded" />
        <div className="skeleton h-4 w-72 rounded" />
      </div>
      {/* Market selector */}
      <div className="card p-1 flex gap-1 mb-5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton flex-1 h-10 rounded" />
        ))}
      </div>
      {/* Info cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card p-3 text-center">
            <div className="skeleton h-3 w-16 mx-auto mb-2 rounded" />
            <div className="skeleton h-4 w-20 mx-auto rounded" />
          </div>
        ))}
      </div>
      {/* Tab switcher */}
      <div className="skeleton h-10 w-full mb-5 rounded-lg" />
      {/* Amount input */}
      <div className="card p-5 mb-4">
        <div className="flex justify-between mb-2">
          <div className="skeleton h-3 w-28 rounded" />
          <div className="skeleton h-3 w-32 rounded" />
        </div>
        <div className="skeleton h-14 w-full rounded" />
      </div>
      {/* Button */}
      <div className="skeleton h-12 w-full rounded" />
    </div>
  );
}
