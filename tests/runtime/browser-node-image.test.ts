import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { browserNodeConfiguration } from "../../deploy/execution/browser-node/configuration.js";

async function docker(args: string[], input = ""): Promise<string> {
  return await new Promise((accept, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "",
      error = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      error += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? accept(output)
        : reject(new Error(`Docker exited ${code}: ${error}`)),
    );
    child.stdin.end(input);
  });
}

// The packaged native invocation owner is exercised unchanged. Only its RPC
// transport is captured; configuration and command authorization are real.
const nativeProbe = String.raw`import assert from 'node:assert/strict';
import {readFile,readdir,access,writeFile} from 'node:fs/promises';
// Resolve the test-only internal entry by its exported function, not a build hash.
let prepareNodeHostRuntime;
for(const name of await readdir('/app/dist')){
 if(!/\.(?:mjs|js)$/.test(name))continue;
 const source=await readFile('/app/dist/'+name,'utf8');
 if(!source.includes('async function prepareNodeHostRuntime('))continue;
 const loaded=await import('/app/dist/'+name);
 prepareNodeHostRuntime=Object.values(loaded).find(value=>typeof value==='function'&&value.name==='prepareNodeHostRuntime');
 if(prepareNodeHostRuntime)break;
}
assert.equal(typeof prepareNodeHostRuntime,'function');
const configPath=process.env.OPENCLAW_CONFIG_PATH;
const original=await readFile(configPath,'utf8');
const config=JSON.parse(original);
const {readConfigFileSnapshotForWrite}=await import('/app/dist/plugin-sdk/config-mutation.js');
const nativeConfig=await readConfigFileSnapshotForWrite({observe:false});
assert.equal(nativeConfig.snapshot.valid,true,JSON.stringify(nativeConfig.snapshot.issues));
const results=new Map();
const prepared=await prepareNodeHostRuntime({config,enableAgentRuns:true});
assert.equal(prepared.workerHostingEnabled,false);
const runtime=prepared.start({client:{async request(method,params){if(method==='node.invoke.result')results.set(params.id,params);return method==='skills.bins'?{bins:[]}:{ok:true};}}});
async function invoke(command,params){const id=crypto.randomUUID();await runtime.invoke({id,nodeId:'owned-unit-fixture',command,paramsJSON:JSON.stringify(params),timeoutMs:15000,idempotencyKey:null});const result=results.get(id);assert.ok(result,'missing native result');return result;}
try {
 const snapshot=await invoke('system.execApprovals.get',{});
 assert.equal(snapshot.ok,true);
 const before=JSON.parse(snapshot.payloadJSON);
 const full=await invoke('system.execApprovals.set',{baseHash:before.hash,file:{version:1,defaults:{security:'full',ask:'off',askFallback:'full',autoAllowSkills:true},agents:{'*':{security:'full',ask:'off',askFallback:'full',autoAllowSkills:true}}}});
 assert.equal(full.ok,true);
 const allowed=JSON.parse(full.payloadJSON);
 assert.equal(allowed.file.defaults.security,'full');
 const denied=await invoke('system.run',{command:['/bin/sh','-c','printf escaped > /tmp/execution-escaped'],rawCommand:'printf escaped > /tmp/execution-escaped',security:'full',ask:'off'});
 console.log(JSON.stringify({nativeDenial:denied}));assert.equal(denied.ok,false);
 assert.equal(denied.error.code,'SYSTEM_RUN_DENIED');assert.equal(denied.error.message,'SYSTEM_RUN_DISABLED: security=deny');
 assert.equal(await access('/tmp/execution-escaped').then(()=>true,()=>false),false);
 let immutable=false;try{await writeFile(configPath,'{}');}catch(e){immutable=['EROFS','EACCES'].includes(e.code);}assert.equal(immutable,true);
 for(const name of ['../../openclaw.json','/configuration/openclaw.json','..\\..\\openclaw.json']){
  const uploaded=await invoke('terminal.upload',{name,contentBase64:Buffer.from('overwrite-attempt').toString('base64')});
  assert.equal(uploaded.ok,true);
  const file=JSON.parse(uploaded.payloadJSON);
  assert.ok(file.path.startsWith('/tmp/'));
  assert.notEqual(file.path,configPath);
 }
 assert.equal(await readFile(configPath,'utf8'),original);
 for(const server of ['https://example.com/mcp','http://127.0.0.1:18989','new-server']){const result=await invoke('mcp.tools.call.v1',{server,tool:'fetch',arguments:{url:'https://example.com'},url:'https://example.com/mcp'});assert.equal(result.ok,false);assert.equal(result.error.code,'MCP_SERVER_UNAVAILABLE');}
 const listing=await invoke('fs.listDir',{path:'/configuration'});assert.equal(listing.ok,true);
 console.log(JSON.stringify({nodeCommands:prepared.manifest.commands,approvals:'full',nativeExecOutcome:denied.error,markerCreated:false,configImmutable:true,traversalUploadsConfined:true,arbitraryMcpServersDenied:true,configUnchanged:true,workerHosting:prepared.workerHostingEnabled}));
} finally {runtime.cancelAll();await runtime.close();}
`;
const image = process.env.CLAWSCARF_TEST_BROWSER_NODE_IMAGE;
await test(
  "pinned native browser node denies exec despite full approvals and confines uploads",
  { skip: !image, timeout: 60000 },
  async () => {
    assert.ok(image);
    const volume = `cs-browser-node-test-${randomUUID()}`;
    const config = browserNodeConfiguration(
      `http://openclaw:${"a".repeat(32)}@browser:9223`,
    );
    try {
      await docker(["volume", "create", volume]);
      await docker(
        [
          "run",
          "--rm",
          "-i",
          "--network",
          "none",
          "--user",
          "0",
          "--cap-drop",
          "ALL",
          "--cap-add",
          "CHOWN",
          "-v",
          `${volume}:/configuration`,
          "--entrypoint",
          "node",
          image,
          "-e",
          'const fs=require("node:fs");let data="";process.stdin.on("data",part=>data+=part).on("end",()=>{fs.writeFileSync("/configuration/openclaw.json",data,{mode:0o600});fs.chownSync("/configuration/openclaw.json",1000,1000)})',
        ],
        JSON.stringify(config),
      );
      const result = await docker(
        [
          "run",
          "--rm",
          "-i",
          "--network",
          "none",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--user",
          "1000:1000",
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,mode=1777",
          "--tmpfs",
          "/state:rw,nosuid,nodev,uid=1000,gid=1000,mode=700",
          "-v",
          `${volume}:/configuration:ro`,
          "--entrypoint",
          "node",
          image,
          "--input-type=module",
        ],
        nativeProbe,
      );
      assert.ok(result.includes('"configUnchanged":true'));
      assert.ok(result.includes('"arbitraryMcpServersDenied":true'));
    } finally {
      await docker(["volume", "rm", volume]);
    }
  },
);
