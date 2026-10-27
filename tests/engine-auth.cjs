const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../.cache/dim');
const ts=require(path.join(root,'node_modules/typescript'));
const source=fs.readFileSync(path.join(root,'src/app/bungie-api/oauth-tokens.ts'),'utf8');
function fixture(session){
 const values=new Map();if(session)values.set('little-light-bungie-session-v1',JSON.stringify(session));
 const context={exports:{},Date,sessionStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
 return {api:context.exports,values};
}
test('DIM accepts Public OAuth session without a refresh token and preserves Bungie user ID',()=>{
 const {api}=fixture({access_token:'synthetic-token',membership_id:'123',expires_at:Date.now()+60000});
 assert.equal(api.hasValidAuthTokens(),true);assert.equal(api.getToken().bungieMembershipId,'123');assert.equal(api.getToken().refreshToken,undefined);
});
test('expired and malformed sessions do not authenticate',()=>{
 assert.equal(fixture({access_token:'fixture',membership_id:'123',expires_at:Date.now()-1000}).api.hasValidAuthTokens(),false);
 assert.equal(fixture({access_token:'fixture',membership_id:'123'}).api.hasValidAuthTokens(),false);
 const {api,values}=fixture();values.set('little-light-bungie-session-v1','invalid');assert.equal(api.hasValidAuthTokens(),false);
});
test('sign-out clears the shared session and native fallback token',()=>{
 const {api,values}=fixture({access_token:'fixture',membership_id:'123',expires_at:Date.now()+60000});
 values.set('authorization','{}');api.removeToken();assert.equal(values.size,0);assert.equal(api.hasValidAuthTokens(),false);
});
test('access-token revocation cannot keep reusing the shared session',()=>{
 const {api}=fixture({access_token:'fixture',membership_id:'123',expires_at:Date.now()+60000});api.removeAccessToken();assert.equal(api.hasValidAuthTokens(),false);
});
