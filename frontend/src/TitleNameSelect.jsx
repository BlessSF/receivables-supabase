/** Picks the name saved under an account title (for example which supplier). Fills itself from the title chosen. */
export default function TitleNameSelect({ category, value, onChange, titleNames, className = '', ...rest }) {
  const names = (titleNames && titleNames[category]) || [];
  if (!names.length && !value) {
    return <select {...rest} className={className} disabled value=""><option value="">No names saved for {category}</option></select>;
  }
  const opts = [...new Set([...names, ...(value ? [value] : [])])];
  return (
    <select {...rest} className={className} value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Choose —</option>
      {opts.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}