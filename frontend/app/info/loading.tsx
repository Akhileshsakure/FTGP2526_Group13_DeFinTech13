// app/info/loading.tsx
export default function InfoLoading() {
  return (
    <div className="fade-up max-w-3xl mx-auto">
      <div className="mb-8">
        <div className="skeleton h-9 w-48 mb-2 rounded" />
        <div className="skeleton h-4 w-96 rounded" />
      </div>

      {/* Protocol params skeleton */}
      <div className="mb-8">
        <div className="skeleton h-6 w-48 mb-4 rounded" />
        <div className="card p-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4 py-3">
              <div className="skeleton h-4 w-32 rounded" />
              <div className="skeleton h-4 w-64 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Interest rate chart skeleton */}
      <div className="mb-8">
        <div className="skeleton h-6 w-56 mb-4 rounded" />
        <div className="card p-5">
          <div className="skeleton h-4 w-full mb-4 rounded" />
          <div className="skeleton h-64 w-full mb-4 rounded" />
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-20 rounded-lg" />
            ))}
          </div>
        </div>
      </div>

      {/* FAQ skeleton */}
      <div className="mb-8">
        <div className="skeleton h-6 w-64 mb-4 rounded" />
        <div className="grid gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-14 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
