import { readConversionPages, ConversionError, type TextBlock, type ConversionPage } from './conversion-profile';
import { validateDataTable, type DataTable } from '../data/table';

/** Baseline rows, then stable x anchors. Candidates require review; no merge/numeric inference. */
export function tableCandidates(pages: readonly ConversionPage[]): DataTable[] {
  const tables:DataTable[]=[];
  for(const page of pages){
    const lines:TextBlock[][]=[];
    for(const block of [...page.text].sort((a,b)=>a.y-b.y||a.x-b.x)){
      const line=lines.find(row=>Math.abs(row[0].y-block.y)<=Math.min(row[0].height,block.height)*0.35);
      if(line)line.push(block);else lines.push([block]);
    }
    let group:TextBlock[][]=[];
    const flush=()=>{
      if(group.length>=3){
        const sorted=group.map(row=>[...row].sort((a,b)=>a.x-b.x));
        const table:DataTable={id:`pdf-table-${page.index}-${tables.length}`,columns:sorted[0].map((cell,i)=>({id:`column-${i+1}`,label:cell.text,type:'text'})),rows:sorted.slice(1).map(row=>row.map(cell=>cell.text))};
        validateDataTable(table);tables.push(table);
      }
      group=[];
    };
    for(const line of lines){
      line.sort((a,b)=>a.x-b.x);
      if(line.length<2){flush();continue;}
      if(group.length && (line.length!==group[0].length || line.some((cell,i)=>Math.abs(cell.x-group[0][i].x)>8) || line[0].y-group[group.length-1][0].y>line[0].height*4))flush();
      group.push(line);
    }
    flush();
  }
  return tables;
}
export async function extractTables(bytes: Uint8Array, pages?: readonly number[], signal: AbortSignal=new AbortController().signal): Promise<DataTable[]> {
  const result=tableCandidates(await readConversionPages(bytes,pages,'editable',signal));
  if(!result.length)throw new ConversionError('no-table-candidates');return result;
}
