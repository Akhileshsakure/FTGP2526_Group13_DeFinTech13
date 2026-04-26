// app/markets/loading.tsx
export default function MarketsLoading() {
  return (
    <div className="fade-up">
      <div className="mb-8">
        <div className="skeleton h-9 w-32 mb-2 rounded" />
        <div className="skeleton h-4 w-80 rounded" />
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="skeleton w-9 h-9 rounded-full" />
              <div>
                <div className="skeleton h-4 w-12 mb-1.5 rounded" />
                <div className="skeleton h-3 w-20 rounded" />
              </div>
              <div className="ml-auto">
                <div className="skeleton h-4 w-16 mb-1.5 rounded" />
                <div className="skeleton h-3 w-12 rounded" />
              </div>
            </div>
            <div className="skeleton h-px w-full mb-4" />
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="skeleton h-10 rounded" />
              <div className="skeleton h-10 rounded" />
            </div>
            <div className="skeleton h-1.5 w-full mb-1 rounded-full" />
            <div className="skeleton h-3 w-full mb-4 rounded" />
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[1, 2, 3, 4].map((j) => <div key={j} className="skeleton h-8 rounded" />)}
            </div>
            <div className="flex gap-2">
              <div className="skeleton flex-1 h-9 rounded" />
              <div className="skeleton flex-1 h-9 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
