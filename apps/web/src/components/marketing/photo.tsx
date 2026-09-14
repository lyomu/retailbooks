type PhotoProps = {
  id?: string;
  src?: string;
  alt: string;
  className?: string;
  ratio?: string;
  width?: number;
};

function photoUrl(id: string, width: number) {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=80`;
}

export function Photo({ id, src, alt, className, ratio = '4 / 3', width = 1200 }: PhotoProps) {
  const imageUrl = src ?? photoUrl(id ?? 'photo-1556761175-b413da4baf72', width);

  return (
    <div
      role="img"
      aria-label={alt}
      className={className ? `mk-photo ${className}` : 'mk-photo'}
      style={{
        aspectRatio: ratio,
        backgroundColor: 'hsl(var(--rb-secondary))',
        backgroundImage: `url('${imageUrl}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    />
  );
}
