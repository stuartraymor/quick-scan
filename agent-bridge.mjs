import { Client } from './mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const client = new Client({name:'codex-local-bridge',version:'1.0.0'});
const transport = new StdioClientTransport({command:process.execPath,args:[new URL('./mcp/bin/scanruler-mcp.js',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),'--allow-origin','scanruler://app','--tools','compact','--no-update','--out','C:/Users/stuar/Documents/Codex/2026-11-01/so/outputs'],stderr:'pipe'});
transport.stderr?.on('data', data=>process.stderr.write(data));
await client.connect(transport);
const token = randomBytes(32).toString('hex');
const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/tool'||req.headers.authorization!==`Bearer ${token}`){res.writeHead(403);res.end();return;}
  try{
    let body='';for await(const chunk of req){body+=chunk;if(body.length>2000000)throw Error('Request too large');}
    const input=JSON.parse(body);
    const result=input.list?await client.listTools():await client.callTool(input,undefined,{timeout:300000});
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
  }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:String(error)}));}
});
server.listen(0,'127.0.0.1',()=>{writeFileSync('C:/Users/stuar/Documents/Codex/2026-11-01/so/work/scanruler-bridge.json',JSON.stringify({port:server.address().port,token}));console.log('ScanRuler bridge ready');});
