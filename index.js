const fetch = require('cross-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const ClonesType = {
    ContentError: "ContentError",
    Undefined: "Undefined",
    genericFarming: "genericFarming",
    gooseFarm: "gooseFarm",
    genericLending: "genericLending",
    compoundClone: "compoundClone",
}

function typeInfo( id ){
    return ClonesType[id]
}
async function get(url){
    try {
        const res = await fetch(url);
        if (res.status >= 400) {
            console.log("\t" + url + " ERROR STATUS=" + res.status + " FOR " + res.statusText);
            return;
        }
        return await res.text();
    }catch(e){
        console.log(url + '> ' + e.toString());
        return '';
    }
}

async function processArgs() {
    const isVfat = process.argv[2] == 'vfat' ? true : false;
    if( isVfat ){
        processVfatCat();
    }else{
        processUrlOnArgs();
    }
}

async function processVfatCat() {

    // fetch vfat vfat page:
    const file = `./buffer/${process.argv[3]}.txt`;
    const body = fs.readFileSync(file, "utf-8");

    // extract all links in the category
    const rx = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g
    const rxMatch = body.match(rx);
    for (let i = 0; i < rxMatch.length; i++) {
        const url = `${rxMatch[i]}`;
        await doDetectionOnUrl(url);
    }
}

async function processUrlOnArgs() {
    const arg = process.argv;
    for (let i = 2; i < arg.length; i++) {
        const url = `${arg[i]}`;
        await doDetectionOnUrl(url);
    }
}

async function doDetectionOnUrl( url ){
    const body = await fetchAndStoreContents(url);
    const type = detectPatternsOn(body);
    const appTypeInfo = typeInfo(type);
    console.log(`App ${url} is ${appTypeInfo}`);
}

function detectPatternsOn(body) {

    if( ! body || body.length == 0 )
        return ClonesType.ContentError;

    let result;

    result = detectorGooseFarm(body, ClonesType.gooseFarm);
    if ( result !== ClonesType.Undefined ) return result;

    result = detectorGenericFarm(body, ClonesType.genericFarming);
    if ( result !== ClonesType.Undefined ) return result;

    result = detectorCompound(body, ClonesType.compoundClone);
    if ( result !== ClonesType.Undefined ) return result;

    result = detectorGenericLending(body, ClonesType.genericLending);
    if ( result !== ClonesType.Undefined ) return result;

    return ClonesType.Undefined;
}

function detectorCompound(body, returnType) {
    // must have all this patterns
    const patterns = [/ComptrollerInterface/gi,/InterestRateModel/gi];
    for( let i in patterns ){
        const pattern = patterns[i];
        const rx = new RegExp(pattern);
        const rxMatch = body.match(rx);
        // console.log("\t", pattern, rxMatch ? rxMatch.length : false);
        if( rxMatch === null )
            // if one pattern is missing we return to try next detection
            return ClonesType.Undefined;
    }
    return returnType;
}

function detectorGenericLending(body, returnType) {
    // must have all this patterns
    const patterns = [/borrow/gi,/lend/gi,/repay/gi,/markets/gi];
    for( let i in patterns ){
        const pattern = patterns[i];
        const rx = new RegExp(pattern);
        const rxMatch = body.match(rx);
        // console.log("\t", pattern, rxMatch ? rxMatch.length : false);
        if( rxMatch === null )
            // if one pattern is missing we return to try next detection
            return ClonesType.Undefined;
    }
    return returnType;
}

function detectorGenericFarm(body, returnType) {
    // must have all this patterns
    const patterns = [/"deposit"/gi,/"withdraw"/gi,/"pending[a-zA-Z]+"/gi,/"poolLength"/gi,
        /"allocPoint"/gi];
    for( let i in patterns ){
        const pattern = patterns[i];
        const rx = new RegExp(pattern);
        const rxMatch = body.match(rx);
        // console.log("\t", pattern, rxMatch ? rxMatch.length : false);
        if( rxMatch === null )
            // if one pattern is missing we return to try next detection
            return ClonesType.Undefined;
    }
    return returnType;
}

function detectorGooseFarm(body, returnType) {
    // must have all this patterns
    const patterns = [/"deposit"/gi,/"withdraw"/gi,/"pending[a-zA-Z]+"/gi,/"poolLength"/gi,
        /"allocPoint"/gi, /"depositFeeBP"/gi];
    for( let i in patterns ){
        const pattern = patterns[i];
        const rx = new RegExp(pattern);
        const rxMatch = body.match(rx);
        // console.log("\t", pattern, rxMatch ? rxMatch.length : false);
        if( rxMatch === null )
            // if one pattern is missing we return to try next detection
            return ClonesType.Undefined;
    }
    return returnType;
}

async function fetchAndStoreContents(url) {
    const hostUrl = new URL(url);
    const file = `./buffer/${hostUrl.host}.html`;
    if( fs.existsSync(file) ){
        return  fs.readFileSync(file, "utf-8");
    }
    const body = await get(url);
    if( ! body ) return '';
    // to avoid path in the url, like /info
    const baseUrl = `${hostUrl.protocol}//${hostUrl.host}/`;
    const scripts = await fetchAllScriptData(baseUrl, body);
    const html = `${body}\n<script>${scripts}</script>`;
    fs.writeFileSync(file, html);
    return html;
}

async function fetchAllScriptData(url, body) {
    if( ! body ) return '';
    const DOM = cheerio.load(body);
    const scripts = DOM('script');
    let allData = '\n';
    for (let i = 0; i < scripts.length; i++) {
        const link = scripts[i];
        let uri = `${DOM(link).attr('src')}`;

        if (uri.indexOf('://') !== -1) {
            if (uri.indexOf('.js') === -1) {
                // we don't care about external libs
                continue;
            }
        }
        console.log(uri);
        if( uri === "undefined" ) continue;
        let contentUrl;
        if( uri.indexOf('://') !== -1 ){
            // this is a url external script
            contentUrl = uri;
        } else{
            // local app script
            contentUrl = new URL(url + '/' + uri).toString();
        }
        // console.log( contentUrl );
        const scriptData = await get(contentUrl);
        if( ! scriptData){
            // ignore content fetch errors
            continue;
        }
        allData += '\n// '+uri+'\n'+scriptData;
    }
    return allData;
}

/*
async function fetchAllPreFetchData(url, body) {
    const DOM = cheerio.load(body);
    const scripts = DOM('link');
    let allData = '\n';
    for (let i = 0; i < scripts.length; i++) {
        const link = scripts[i];
        let uri = `${DOM(link).attr('href')}`;
        if (uri.indexOf('://') !== -1) {
            // we don't care about external libs
            continue;
        }
        if (uri.indexOf('.css') !== -1) {
            // we don't care about css
            continue;
        }
        if (uri.indexOf('.ico') !== -1) {
            // we don't care about css
            continue;
        }
        const contentUrl = url + uri;
        const scriptData = await get(contentUrl);
        if( ! scriptData){
            // ignore content fetch errors
            continue;
        }
        allData += '\n// '+uri+'\n'+scriptData;
    }
    return allData;
}
*/



processArgs();
