const H=(process.env.TFY_HOST||"").replace(/\/+$/,""), K=process.env.TFY_API_KEY||"", G=process.env.TFY_SECRET_GROUP||"";
const tfy=async(p,init={})=>{const r=await fetch(`${H}/api/svc${p}`,{...init,headers:{Authorization:`Bearer ${K}`,"Content-Type":"application/json",...(init.headers||{})}});const t=await r.text();return{ok:r.ok,status:r.status,text:t};};
const groups=await tfy(`/v1/secret-groups?search=${encodeURIComponent(G)}&limit=20`);
if(!groups.ok){console.log("secret-groups call:",groups.status,groups.text.slice(0,200));process.exit(1);}
let gd; try{gd=JSON.parse(groups.text).data||[];}catch{console.log("parse:",groups.text.slice(0,200));process.exit(1);}
const grp=gd.find(x=>x.fqn&&x.fqn.endsWith(":"+G))||gd[0];
if(!grp){console.log("group not found. groups seen:",gd.map(x=>x.name||x.fqn));process.exit(1);}
console.log("group:",grp.name||grp.fqn,"| id:",grp.id);
const secs=await tfy(`/v1/secrets`,{method:"POST",body:JSON.stringify({secretGroupId:grp.id,withValue:true,limit:100})});
if(!secs.ok){console.log("secrets call:",secs.status,secs.text.slice(0,200));process.exit(1);}
const data=JSON.parse(secs.text).data||[];
console.log("\nvalue read-back:");
for(const x of data) console.log("  ",x.name, x.value?`value=OK (${x.value.length} chars)`:"value=NULL");
const allOk=data.length && data.every(x=>x.value);
console.log(allOk?"\nRESULT: YES — read-back works. NoLeak can source the secret from TrueFoundry.":"\nRESULT: NO — values not returned (need injection fallback).");
process.exit(allOk?0:1);
