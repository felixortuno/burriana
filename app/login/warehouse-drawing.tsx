// Plan of the two zones the app manages, in the proportions of plano 08: the
// cardboard warehouse top left, box assembly and storage wrapping around it.
// The small blocks are floor pallet positions — what the app gives codes to.

const BLOCK = { width: 104, height: 44, gapX: 16, gapY: 20 };

type Bank = { x: number; y: number; columns: number; rows: number; zone: 'carton' | 'montaje' };

const zoneStroke = { carton: '#4fbf99', montaje: '#d9a848' };

const banks: Bank[] = [
  // Almacén de cartón: two banks either side of a working aisle.
  { x: 160, y: 100, columns: 2, rows: 7, zone: 'carton' },
  { x: 504, y: 100, columns: 2, rows: 7, zone: 'carton' },
  // The tall right hall.
  { x: 976, y: 157, columns: 3, rows: 14, zone: 'montaje' },
  { x: 1470, y: 157, columns: 3, rows: 14, zone: 'montaje' },
  // The lower strip, which stops short of the dock apron kept clear for loading.
  { x: 92, y: 665, columns: 6, rows: 5, zone: 'montaje' },
];

function bankBlocks({ x, y, columns, rows, zone }: Bank) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push(
        <rect
          key={`${x}-${y}-${row}-${column}`}
          x={x + column * (BLOCK.width + BLOCK.gapX)}
          y={y + row * (BLOCK.height + BLOCK.gapY)}
          width={BLOCK.width}
          height={BLOCK.height}
          rx="3"
          fill={zoneStroke[zone]}
          fillOpacity=".13"
          stroke={zoneStroke[zone]}
          strokeOpacity=".45"
          strokeWidth="2"
        />,
      );
    }
  }
  return cells;
}

export default function WarehouseDrawing() {
  return (
    <svg viewBox="0 0 1964 1220" className="login-drawing" aria-hidden="true">
      {/* Dimension rule along the top, as on the original sheet. */}
      <g stroke="#355c53" strokeWidth="2">
        <line x1="35" y1="16" x2="1929" y2="16" />
        {Array.from({ length: 20 }, (_, index) => {
          const x = 35 + (index * (1929 - 35)) / 19;
          return <line key={index} x1={x} y1="16" x2={x} y2={index % 5 ? 26 : 34} />;
        })}
      </g>

      <path d="M35 65H1929V1185H35Z" fill="none" stroke="#548074" strokeWidth="4" />
      <path d="M35 65H852V624H35Z" fill="#168769" fillOpacity=".10" stroke={zoneStroke.carton} strokeWidth="5" />
      <path
        d="M860 65H1929V1185H35V635H860Z"
        fill="#b88726"
        fillOpacity=".07"
        stroke={zoneStroke.montaje}
        strokeWidth="5"
      />

      <g transform="translate(0 30)">{banks.map(bankBlocks)}</g>

    </svg>
  );
}
