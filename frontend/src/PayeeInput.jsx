import { useId } from 'react';

/** Payee box: type freely, or pick from the names saved under the chosen account title (Account Titles page). */
export default function PayeeInput({ value, onChange, category, titleNames, className = '', ...rest }) {
  const id = useId();
  const names = (titleNames && titleNames[category]) || [];
  return (
    <>
      <input
        {...rest}
        className={className}
        list={names.length ? id : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={names.length ? `Choose or type a ${category.toLowerCase()} name` : (rest.placeholder || 'Payee name')}
      />
      {names.length > 0 && <datalist id={id}>{names.map((n) => <option key={n} value={n} />)}</datalist>}
    </>
  );
}