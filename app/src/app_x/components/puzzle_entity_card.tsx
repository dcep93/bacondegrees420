/** A deliberately passive card: puzzle guesses expose no metadata or navigation controls. */
export default function PuzzleEntityCard({
  name, imageUrl, year, dimmed = false, hideCopy = false,
}: {
  name: string;
  imageUrl?: string | null;
  year?: string;
  dimmed?: boolean;
  hideCopy?: boolean;
}) {
  return (
    <article className={`cinenerdle-card${dimmed ? " bacon-connection-node-dimmed" : ""}`}>
      <div className="cinenerdle-card-image-shell">
        {imageUrl ? (
          <img alt={name} className="cinenerdle-card-image" loading="lazy" src={imageUrl} />
        ) : <div className="cinenerdle-card-image cinenerdle-card-image-fallback">{name}</div>}
      </div>
      {hideCopy ? null : (
        <div className="cinenerdle-card-copy">
          <p className="cinenerdle-card-title">{name}</p>
          {year ? <p className="cinenerdle-card-subtitle">{year}</p> : null}
        </div>
      )}
    </article>
  );
}
