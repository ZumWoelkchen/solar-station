const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const stream = require('stream');
const { promisify } = require('util');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = 3000;
const API_KEY = 'DEMO_KEY'; 

// DIRECTORIES
const CACHE_DIR = path.join(__dirname, 'public', 'cache');
const DATA_DIR = path.join(__dirname, 'data_storage'); 

const NOAA_BASE_URL = 'https://services.swpc.noaa.gov/images/';
const STEREO_PAGE_URL = 'https://stereo-ssc.nascom.nasa.gov/beacon/beacon_secchi.shtml';
const STEREO_BASE_URL = 'https://stereo-ssc.nascom.nasa.gov';
const GONG_URL = 'https://farside.nso.edu/calib_gallery.html';
const GONG_BASE = 'https://farside.nso.edu';

// Ensure directories exist
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// --- LOGGER ---
const log = (tag, msg) => {
    const time = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[${time}] [${tag}] ${msg}`);
};

/**
 * Batch Downloader with Service-Friendly Logging
 * @param {string} tag - Log tag (e.g., 'ENLIL')
 * @param {Array} items - Array of {url, filename}
 * @param {string} destDir - Destination directory
 * @param {boolean} verbose - If true, logs every file. If false, logs every 10% progress.
 */
const downloadBatch = async (tag, items, destDir, verbose = false) => {
    if(items.length === 0) return;
    const total = items.length;
    let completed = 0;
    let nextMilestone = 10; // Start reporting at 10%

    log(tag, `Starting batch download of ${total} files...`);

    const runItem = async (item) => {
        const dest = path.join(destDir, item.filename);
        const success = await downloadFile(item.url, dest);
        
        if (success) {
            completed++;
            
            if (verbose) {
                // Verbose Mode: Log every single file
                log(tag, `[OK] ${item.filename}`);
            } else {
                // Bulk Mode: Log every 10%
                const percent = Math.floor((completed / total) * 100);
                if (percent >= nextMilestone) {
                    log(tag, `Progress: ${percent}% (${completed}/${total})`);
                    nextMilestone += 10;
                }
            }
        } else {
            log(tag, `[FAIL] ${item.filename}`);
        }
    };

    // Parallelism Limit: 5
    for(let i=0; i < items.length; i+=5) {
        const chunk = items.slice(i, i+5);
        await Promise.all(chunk.map(runItem));
    }
    
    log(tag, `Batch complete. Downloaded ${completed}/${total} files.`);
};

// --- CONFIGURATION ---

const PINNED_RESOURCES = [
    { id: 'enlil_anim.mp4', name: 'WSA-ENLIL PREDICTION', cat: 'dashboard' },
    { id: 'drap_global_anim.mp4', name: 'D-RAP GLOBAL (ANIMATION)', cat: 'ionosphere' }, 
    { id: 'sdo_hmib.mp4', name: 'SDO MAGNETOGRAM', cat: 'dashboard' },
    { id: 'sdo_hmibc.mp4', name: 'SDO MAGNETOGRAM (COLOR)', cat: 'dashboard' },
    { id: 'sdo_hmii.mp4', name: 'SDO INTENSITYGRAM', cat: 'dashboard' },
    { id: 'swx-overview-large.gif', name: 'SOLAR WIND (Real-Time)', cat: 'dashboard' },
    { id: 'station-k-index.png', name: 'PLANETARY K-INDEX', cat: 'dashboard' },
    { id: 'aurora-forecast-northern-hemisphere.jpg', name: 'AURORA BOREALIS', cat: 'dashboard' },
    { id: 'geospace_geospace_timeline_critical.png', name: 'GEOSPACE TIMELINE', cat: 'dashboard' }
];

const NASA_RESOURCES = [
    { id: 'lasco_c2', name: 'LASCO C2 (Red)', type: 'movie', jpg: 'https://sohowww.nascom.nasa.gov/data/realtime/c2/1024/latest.jpg', gif: 'https://sohowww.nascom.nasa.gov/data/LATEST/current_c2.gif' },
    { id: 'lasco_c3', name: 'LASCO C3 (Blue)', type: 'movie', jpg: 'https://sohowww.nascom.nasa.gov/data/realtime/c3/1024/latest.jpg', gif: 'https://sohowww.nascom.nasa.gov/data/LATEST/current_c3.gif' },
    { id: 'sdo_193', name: 'SDO 193', type: 'static', jpg: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_2048_0193.jpg' },
    { id: 'sdo_304', name: 'SDO 304', type: 'static', jpg: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_2048_0304.jpg' },
    { id: 'sdo_335', name: 'SDO 335', type: 'static', jpg: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_2048_0335.jpg' },
    { id: 'sdo_211', name: 'SDO 211', type: 'static', jpg: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_2048_0211.jpg' },
    { id: 'sdo_171', name: 'SDO 171', type: 'static', jpg: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_2048_0171.jpg' },
    { id: 'hmi_mag', name: 'HMI Magnetogram', type: 'static', jpg: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_2048_HMIB.jpg' },
    { id: 'hmi_ic', name: 'HMI Visible Sunspots', type: 'static', jpg: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_2048_HMII.jpg' },
    { id: 'hmi_iic', name: 'HMI Continuum', type: 'static', jpg: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_2048_HMIIC.jpg' }
];

const MANUAL_DOWNLOADS = [
    // --- SDO MP4s (NASA) ---
    { url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/mpeg/latest_1024_HMIB.mp4', filename: 'sdo_hmib.mp4' },
    { url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/mpeg/latest_1024_HMIBC.mp4', filename: 'sdo_hmibc.mp4' },
    { url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/mpeg/latest_1024_HMII.mp4', filename: 'sdo_hmii.mp4' },
    { url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/mpeg/latest_1024_0094.mp4', filename: 'latest_094.mp4' },
    { url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/mpeg/latest_1024_0171.mp4', filename: 'latest_171.mp4' },
    { url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/mpeg/latest_1024_0131.mp4', filename: 'latest_131.mp4' },
    { url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/mpeg/latest_1024_0193.mp4', filename: 'latest_193.mp4' },

    // --- NOAA DASHBOARD ---
    { url: 'https://services.swpc.noaa.gov/images/swx-overview-large.gif', filename: 'swx-overview-large.gif' },
    { url: 'https://services.swpc.noaa.gov/images/station-k-index.png', filename: 'station-k-index.png' },
    { url: 'https://services.swpc.noaa.gov/images/aurora-forecast-northern-hemisphere.jpg', filename: 'aurora-forecast-northern-hemisphere.jpg' },
    { url: 'https://services.swpc.noaa.gov/images/synoptic-map.jpg', filename: 'synoptic-map.jpg' },
    
    // --- ACE ---
    { url: 'https://services.swpc.noaa.gov/images/ace-mag-24-hour.gif', filename: 'ace-mag-24.gif' },
    { url: 'https://services.swpc.noaa.gov/images/ace-swepam-24-hour.gif', filename: 'ace-swepam-24.gif' },
    { url: 'https://services.swpc.noaa.gov/images/ace-epam-24-hour.gif', filename: 'ace-epam-24.gif' },
    { url: 'https://services.swpc.noaa.gov/images/ace-sis-24-hour.gif', filename: 'ace-sis-24-hour.gif' },
    
    // --- GOES / SEASRT ---
    { url: 'https://services.swpc.noaa.gov/images/seaesrt-space-environment.png', filename: 'seaesrt-space-environment.png' },
    { url: 'https://services.swpc.noaa.gov/images/seaesrt-charging-hazards.png', filename: 'seaesrt-charging-hazards.png' }
];

['global', 'north-pole', 'south-pole'].forEach(region => {
    MANUAL_DOWNLOADS.push({ url: `https://services.swpc.noaa.gov/images/d-rap/${region}.png`, filename: `drap_static_${region}.png` });
    ['_f05', '_f10', '_f15', '_f20', '_f25', '_f30'].forEach(f => {
        MANUAL_DOWNLOADS.push({ url: `https://services.swpc.noaa.gov/images/d-rap/${region}${f}.png`, filename: `drap_static_${region}${f}.png` });
    });
});

// --- HELPERS ---

const ensureDir = (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); return dir; };

const publishFile = (sourceDir, filename) => {
    try {
        const src = path.join(sourceDir, filename);
        if(fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(CACHE_DIR, filename));
            return true;
        }
    } catch(e) { }
    return false;
};

const downloadFile = async (url, filepath) => {
    if (!url) return false;
    try {
        const response = await axios({ method: 'GET', url: url, responseType: 'stream', timeout: 30000 });
        const writer = fs.createWriteStream(filepath);
        response.data.pipe(writer);
        await promisify(stream.finished)(writer);
        if (fs.statSync(filepath).size === 0) { fs.unlinkSync(filepath); return false; }
        return true;
    } catch (error) { return false; }
};

// --- CRAWLERS ---

const syncEnlil = async () => {
    log('ENLIL', 'Syncing...');
    const WORK_DIR = ensureDir(path.join(DATA_DIR, 'enlil'));
    
    try {
        const { data } = await axios.get(NOAA_BASE_URL + 'animations/enlil/');
        const regex = /href="(enlil_com2_[^"]+\.jpg)"/g;
        let match;
        const frames = [];
        while ((match = regex.exec(data)) !== null) {
            frames.push({ url: NOAA_BASE_URL + 'animations/enlil/' + match[1], filename: 'enlil_' + match[1] });
        }
        
        const existing = new Set(fs.readdirSync(WORK_DIR));
        const toDownload = frames.filter(f => !existing.has(f.filename));
        
        if (toDownload.length > 0) {
            // Bulk mode (false for verbose)
            await downloadBatch('ENLIL', toDownload, WORK_DIR, false);
        } else {
            log('ENLIL', 'Frames up to date.');
        }

        const remoteSet = new Set(frames.map(f => f.filename));
        fs.readdirSync(WORK_DIR).filter(f => f.startsWith('enlil_') && f.endsWith('.jpg')).forEach(f => {
            if (!remoteSet.has(f)) fs.unlinkSync(path.join(WORK_DIR, f));
        });

        const listPath = path.join(WORK_DIR, 'input.txt');
        const outputVideo = path.join(WORK_DIR, 'enlil_anim.mp4');
        const validFrames = fs.readdirSync(WORK_DIR).filter(f => f.startsWith('enlil_enlil') && f.endsWith('.jpg')).sort();
        
        if (validFrames.length > 0) {
            log('ENLIL', 'Rendering video...');
            fs.writeFileSync(listPath, validFrames.map(f => `file '${path.join(WORK_DIR, f)}'\nduration 0.1`).join('\n'));
            await new Promise((resolve, reject) => {
                ffmpeg().input(listPath).inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2', '-crf 20', '-preset fast', '-y'])
                    .save(outputVideo).on('end', resolve).on('error', reject);
            });
            publishFile(WORK_DIR, 'enlil_anim.mp4');
        }
    } catch (e) { log('ENLIL', `Error: ${e.message}`); }
};

const syncDrap = async () => {
    log('DRAP', 'Syncing...');
    const WORK_DIR = ensureDir(path.join(DATA_DIR, 'drap'));
    
    try {
        const { data } = await axios.get(NOAA_BASE_URL + 'animations/d-rap/global/');
        const regex = /href="(SWX_DRAP20_C_SWPC_\d+_GLOBAL\.png)"/g;
        let match;
        const frames = [];
        while ((match = regex.exec(data)) !== null) {
            frames.push({ url: NOAA_BASE_URL + 'animations/d-rap/global/' + match[1], filename: 'drap_anim_' + match[1] });
        }
        frames.sort((a, b) => a.filename.localeCompare(b.filename));
        const recentFrames = frames.slice(0); 

        const existing = new Set(fs.readdirSync(WORK_DIR));
        const toDownload = recentFrames.filter(f => !existing.has(f.filename));

        if (toDownload.length > 0) {
            await downloadBatch('DRAP', toDownload, WORK_DIR, false);
        }

        const keepSet = new Set(recentFrames.map(f => f.filename));
        fs.readdirSync(WORK_DIR).filter(f => f.startsWith('drap_anim_')).forEach(f => {
            if (!keepSet.has(f)) fs.unlinkSync(path.join(WORK_DIR, f));
        });

        const listPath = path.join(WORK_DIR, 'input.txt');
        const outputVideo = path.join(WORK_DIR, 'drap_global_anim.mp4');
        const validFrames = fs.readdirSync(WORK_DIR).filter(f => f.startsWith('drap_anim_') && f.endsWith('.png')).sort();

        if (validFrames.length > 0) {
            log('DRAP', 'Rendering video...');
            fs.writeFileSync(listPath, validFrames.map(f => `file '${path.join(WORK_DIR, f)}'\nduration 0.1`).join('\n'));
            await new Promise((resolve, reject) => {
                ffmpeg().input(listPath).inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2', '-crf 20', '-preset fast', '-y'])
                    .save(outputVideo).on('end', resolve).on('error', reject);
            });
            publishFile(WORK_DIR, 'drap_global_anim.mp4');
        }
    } catch (e) { log('DRAP', `Error: ${e.message}`); }
};

const syncCcor1 = async () => {
    log('CCOR1', 'Syncing...');
    const WORK_DIR = ensureDir(path.join(DATA_DIR, 'ccor1'));
    try {
        const { data } = await axios.get(NOAA_BASE_URL + 'animations/ccor1/');
        const regex = /href="(\d{8}_\d{4}_ccor1_1024by960\.jpg)"/g;
        let match;
        const frames = [];
        while ((match = regex.exec(data)) !== null) {
            frames.push({ url: NOAA_BASE_URL + 'animations/ccor1/' + match[1], filename: 'ccor1_' + match[1] });
        }
        
        const existing = new Set(fs.readdirSync(WORK_DIR));
        const toDownload = frames.filter(f => !existing.has(f.filename));

        if(toDownload.length > 0) {
            await downloadBatch('CCOR1', toDownload, WORK_DIR, false);
        }

        const remoteSet = new Set(frames.map(f => f.filename));
        fs.readdirSync(WORK_DIR).filter(f => f.startsWith('ccor1_')).forEach(f => {
            if (!remoteSet.has(f)) fs.unlinkSync(path.join(WORK_DIR, f));
        });

        const listPath = path.join(WORK_DIR, 'input.txt');
        const outputVideo = path.join(WORK_DIR, 'ccor1_anim.mp4');
        const validFrames = fs.readdirSync(WORK_DIR).filter(f => f.startsWith('ccor1_') && f.endsWith('.jpg')).sort();
        
        if (validFrames.length > 0) {
            log('CCOR1', 'Rendering video...');
            fs.writeFileSync(listPath, validFrames.map(f => `file '${path.join(WORK_DIR, f)}'\nduration 0.08`).join('\n'));
            await new Promise((resolve, reject) => {
                ffmpeg().input(listPath).inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2', '-crf 20', '-preset fast', '-y'])
                    .save(outputVideo).on('end', resolve).on('error', reject);
            });
            publishFile(WORK_DIR, 'ccor1_anim.mp4');
        }
    } catch (e) { log('CCOR1', `Error: ${e.message}`); }
};

const syncGong = async () => {
    log('GONG', 'Syncing...');
    const WORK_DIR = ensureDir(path.join(DATA_DIR, 'gong'));

    try {
        const { data } = await axios.get(GONG_URL);
        const regex = /src="(\/oQR\/fqg\/[^"]+\.jpg)"/gi;
        let match;
        const frames = [];
        while ((match = regex.exec(data)) !== null) {
            frames.push({ url: GONG_BASE + match[1], filename: 'gong_' + match[1].split('/').pop() });
        }
        
        const existing = new Set(fs.readdirSync(WORK_DIR));
        const toDownload = frames.filter(f => !existing.has(f.filename));

        if(toDownload.length > 0) {
            await downloadBatch('GONG', toDownload, WORK_DIR, false);
        } else {
            log('GONG', 'Frames up to date.');
        }

        const remoteSet = new Set(frames.map(f => f.filename));
        fs.readdirSync(WORK_DIR).filter(f => f.startsWith('gong_')).forEach(f => {
            if (!remoteSet.has(f)) fs.unlinkSync(path.join(WORK_DIR, f));
        });

        const validFrames = fs.readdirSync(WORK_DIR).filter(f => f.startsWith('gong_') && f.endsWith('.jpg')).sort();
        
        if (validFrames.length > 0) {
            log('GONG', 'Rendering video...');
            const listPath = path.join(WORK_DIR, 'input.txt');
            const outputVideo = path.join(WORK_DIR, 'gong_anim.mp4');
            fs.writeFileSync(listPath, validFrames.map(f => `file '${path.join(WORK_DIR, f)}'\nduration 0.15`).join('\n'));
            await new Promise((resolve, reject) => {
                ffmpeg().input(listPath).inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2', '-crf 20', '-preset fast', '-y'])
                    .save(outputVideo).on('end', resolve).on('error', reject);
            });
            publishFile(WORK_DIR, 'gong_anim.mp4');
            
            const latest = validFrames[validFrames.length - 1];
            if(latest) publishFile(WORK_DIR, latest);
        }
    } catch (e) { log('GONG', `Error: ${e.message}`); }
};

const syncFlares = async () => {
    log('FLARES', 'Crawling index...');
    const WORK_DIR = ensureDir(path.join(DATA_DIR, 'flares'));
    
    let remoteFiles = new Map();
    const crawlRecursive = async (relPath) => {
        try {
            const { data } = await axios.get(NOAA_BASE_URL + relPath);
            let match;
            const fileRegex = /href="([^"]+\.(png|jpg))"/g;
            while ((match = fileRegex.exec(data)) !== null) {
                remoteFiles.set((relPath + match[1]).replace(/\//g, '_'), NOAA_BASE_URL + relPath + match[1]);
            }
            const dirRegex = /href="([^"]+\/)"/g;
            while ((match = dirRegex.exec(data)) !== null) {
                if (!match[1].startsWith('/')) await crawlRecursive(relPath + match[1]);
            }
        } catch (e) {}
    };
    await crawlRecursive('flares/');
    
    const existing = new Set(fs.readdirSync(WORK_DIR));
    const toDownload = [];
    const changedGroups = new Set();
    
    for (const [name, url] of remoteFiles) {
        if (!existing.has(name)) {
            toDownload.push({ name: name, url: url, filename: name });
            const match = name.match(/^(.*?)_s\d{4}/);
            if(match) changedGroups.add(match[1]);
        }
    }

    if (toDownload.length > 0) {
        // Bulk download (summary mode)
        await downloadBatch('FLARES', toDownload, WORK_DIR, false);
    } else {
        log('FLARES', 'No new images.');
    }

    fs.readdirSync(WORK_DIR).filter(f => f.startsWith('flares_') && f.endsWith('.png')).forEach(f => { 
        if (!remoteFiles.has(f)) fs.unlinkSync(path.join(WORK_DIR, f)); 
    });

    return Array.from(changedGroups);
};

const bundleFlareVideos = async (groups) => {
    if (!groups || groups.length === 0) return;
    log('FFMPEG', `Rendering ${groups.length} flare regions...`);
    const WORK_DIR = path.join(DATA_DIR, 'flares');
    const files = fs.readdirSync(WORK_DIR).filter(f => f.startsWith('flares_'));

    for (const key of groups) {
        const filenames = files.filter(f => f.startsWith(key) && f.endsWith('.png')).sort();
        if (filenames.length < 5) continue;

        const listPath = path.join(WORK_DIR, `${key}.txt`);
        const outputVideo = `flare_anim_${key}.mp4`;
        fs.writeFileSync(listPath, filenames.map(f => `file '${path.join(WORK_DIR, f)}'\nduration 0.15`).join('\n'));
        
        try {
            await new Promise((resolve, reject) => {
                ffmpeg().input(listPath).inputOptions(['-f concat', '-safe 0'])
                    .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2', '-crf 23', '-preset fast', '-y'])
                    .save(path.join(WORK_DIR, outputVideo))
                    .on('end', resolve).on('error', reject);
            });
            publishFile(WORK_DIR, outputVideo);
        } catch(e) { }
    }
};

const fetchStereo = async () => {
    const WORK_DIR = ensureDir(path.join(DATA_DIR, 'stereo'));
    try {
        const { data } = await axios.get(STEREO_PAGE_URL);
        const regex = /src="(\/beacon\/[^"]+\.(jpg|gif))"/gi;
        let match;
        const targets = [];
        while ((match = regex.exec(data)) !== null) {
            targets.push({ url: STEREO_BASE_URL + match[1], filename: 'stereo_' + match[1].split('/').pop() });
        }
        
        // Stereo: Verbose mode (true)
        await downloadBatch('STEREO', targets, WORK_DIR, true);
        
        targets.forEach(t => publishFile(WORK_DIR, t.filename));
    } catch (e) { log('STEREO', `Failed: ${e.message}`); }
};

const fetchDonki = async () => {
    try {
        const startDate = new Date(Date.now()-30*86400000).toISOString().split('T')[0];
        const endDate = new Date().toISOString().split('T')[0];
        const url = `https://api.nasa.gov/DONKI/CME?startDate=${startDate}&endDate=${endDate}&api_key=${API_KEY}`;
        const { data } = await axios.get(url);
        fs.writeFileSync(path.join(CACHE_DIR, 'donki.json'), JSON.stringify(data));
    } catch(e){ log('DONKI', `FAILED. Error: ${e.message}`); }
};

// --- META & SYNC ---

const saveMeta = () => {
    const files = fs.readdirSync(CACHE_DIR).map(f => {
        let cat = 'vault';
        if (f.startsWith('gong_') && f.endsWith('.jpg')) cat = 'gong';
        else if (f === 'ccor1_anim.mp4') cat = 'goes';
        else if (f === 'enlil_anim.mp4') cat = 'seaesrt';
        else if (f === 'gong_anim.mp4') cat = 'gong';
        else if (f === 'drap_global_anim.mp4') cat = 'ionosphere';
        else if (f.startsWith('flare_anim')) cat = 'flares_visual';
        else if (f.startsWith('stereo')) cat = 'stereo';
        else if (f.startsWith('drap_')) cat = 'ionosphere';
        else if (f.startsWith('ace-') || f.includes('proton') || f.includes('electrons') || f.includes('xray')) cat = 'ace';
        else if (f.startsWith('seaesrt') || f.startsWith('geospace')) cat = 'seaesrt';
        else if (f.includes('lasco') && f.endsWith('anim.gif')) cat = 'lasco';
        else if (MANUAL_DOWNLOADS.find(m => m.filename === f)) cat = 'dashboard';
        else if (f.endsWith('.json')) return null;
        
        return { filename: f, category: cat, type: f.endsWith('.mp4') ? 'video' : 'image' };
    }).filter(Boolean).sort((a,b) => a.filename.localeCompare(b.filename));

    fs.writeFileSync(path.join(CACHE_DIR, 'meta.json'), JSON.stringify({ 
        lastUpdated: new Date().toLocaleString(), 
        pinned: PINNED_RESOURCES, 
        files 
    }));
};

const runFullSync = async () => {
    console.log('\n=================================================');
    log('SYSTEM', `STARTING FULL SYNC`);
    
    await fetchDonki();
    
    // Manual & NASA (Static Charts)
    log('CHARTS', 'Updating static charts...');
    const CHART_DIR = ensureDir(path.join(DATA_DIR, 'charts'));
    const all = [...MANUAL_DOWNLOADS, ...NASA_RESOURCES.map(r=>({url:r.jpg, filename:r.id+'.jpg'})), ...NASA_RESOURCES.filter(r=>r.type==='movie').map(r=>({url:r.gif, filename:r.id+'_anim.gif'}))];
    
    // Charts: Verbose mode (true)
    await downloadBatch('CHARTS', all, CHART_DIR, true);
    all.forEach(item => publishFile(CHART_DIR, item.filename));

    await syncEnlil();
    await syncCcor1();
    await syncDrap();
    await syncGong();
    const changed = await syncFlares();
    await bundleFlareVideos(changed);
    await fetchStereo();
    
    saveMeta();
    log('SYSTEM', 'Sync Cycle Complete.');
    console.log('=================================================\n');
};

cron.schedule('*/10 * * * *', async () => { 
    log('CRON', 'Running mini-sync...');
    await fetchStereo(); 
    saveMeta(); 
});
cron.schedule('*/30 * * * *', runFullSync);

app.use(express.static('public'));
app.listen(PORT, async () => {
    log('SERVER', `Solar Station running on http://localhost:${PORT}`);
    if (!fs.existsSync(path.join(CACHE_DIR, 'meta.json'))) await runFullSync();
});
