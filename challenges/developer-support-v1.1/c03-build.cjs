const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const plugins='<build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version><configuration><release>17</release></configuration></plugin><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.2.5</version></plugin></plugins></build>';
const junit='<dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.10.0</version><scope>test</scope></dependency>';
function overlay(root){
 const parent=path.join(root,'C03/LIB/common-primitives/pom.xml'),service=path.join(root,'C03/FIN/ledger-service/pom.xml');
 for(const[file,isService]of [[parent,false],[service,true]]){
 let text=fs.readFileSync(file,'utf8');if(text.includes('maven-surefire-plugin'))continue;
 text=text.replace('</project>',plugins+'</project>');
 text=isService?text.replace('</dependencies>',junit+'</dependencies>'):text.replace('</project>','<dependencies>'+junit+'</dependencies></project>');
 fs.writeFileSync(file,text);
 }
 return [parent,service];
}
if(require.main===module){const dest=path.resolve(process.argv[2]||'');overlay(dest);const out={};for(const sub of ['C03/LIB/common-primitives','C03/FIN/ledger-service']){const dir=path.join(dest,sub);execFileSync('git',['add','pom.xml'],{cwd:dir});execFileSync('git',['-c','user.name=Challenge Setup','-c','user.email=setup@example.invalid','commit','-qm','Pin public challenge Java test build metadata'],{cwd:dir});out[sub]=execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim();}console.log(JSON.stringify(out,null,2));}
module.exports={overlay};
