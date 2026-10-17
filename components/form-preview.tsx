import type { FormSheet } from "@/lib/form-sheet"

export function FormPreview({ sheet }: { sheet: FormSheet }) {
  const cover = sheet.kind === "代課安排"
  return (
    <article data-testid="slip-sheet" data-class={sheet.className || ""} data-form={cover ? "cover" : "swap"} data-sides={sheet.sides > 1 ? "both" : "single"} className="slip-page mx-auto w-full max-w-[210mm] bg-white px-4 py-5 text-black">
      <h2 data-testid="slip-title" className="text-center text-xl font-semibold tracking-wide">
        {sheet.title}
      </h2>
      <div className="mx-auto mt-3 max-w-xl space-y-2 text-base">
        {sheet.className ? (
          <p data-testid="slip-class">
            班別：<span className="slip-blank">{sheet.className}</span>
          </p>
        ) : null}
        {cover ? (
          <p>
            日期：<span className="slip-blank">{sheet.dateLine}</span>
          </p>
        ) : null}
        <p data-testid="slip-reason">
          原因：<span className="slip-blank">{sheet.reason}</span>
        </p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <FormTable headers={sheet.headers} rows={sheet.rows} />
      </div>
      <p className="mt-4 text-base">
        校長簽署：<span className="slip-blank slip-sign" />
      </p>
      {sheet.note ? <p data-testid="slip-note" className="mt-8 text-center text-sm leading-relaxed">{sheet.note}</p> : null}
      {sheet.footer ? <p className="mt-3 text-center text-base leading-relaxed">{sheet.footer}</p> : null}
    </article>
  )
}

function FormTable({ headers, rows }: { headers: string[]; rows: FormSheet["rows"] }) {
  return (
    <table className="w-full table-fixed border-collapse border border-black text-[11px] leading-tight">
      <thead>
        <tr>
          {headers.map((header, index) => (
            <th key={`${header}-${index}`} className="border border-black px-1 py-1 text-center font-medium">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.period}>
            <td className="w-[5.6rem] border border-black px-1 py-0.5 text-center leading-tight">
              <div>{row.period}</div>
              {row.time ? <div>{row.time}</div> : null}
            </td>
            {row.cells.map((cell, index) => (
              <td key={`${row.period}-${index}`} className="border border-black px-0.5 py-0.5 text-center break-words whitespace-pre-wrap">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
