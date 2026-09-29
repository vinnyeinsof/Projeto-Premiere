$._ViniciusCaptionBridge = $._ViniciusCaptionBridge || {};

$._ViniciusCaptionBridge._findItemByName = function(parentItem, targetName) {
    if (!parentItem || !targetName) return null;
    try {
        for (var i = 0; i < parentItem.children.numItems; i++) {
            var child = parentItem.children[i];
            if (child && child.name === targetName) return child;
            if (child && child.type === ProjectItemType.BIN) {
                var found = $._ViniciusCaptionBridge._findItemByName(child, targetName);
                if (found) return found;
            }
        }
    } catch (e) {}
    return null;
};

$._ViniciusCaptionBridge.createCaptionTrack = function(srtPath, sequenceName) {
    try {
        if (!app.project) return JSON.stringify({ ok:false, error:'Nenhum projeto aberto.' });
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ ok:false, error:'Nenhuma sequência ativa.' });
        if (sequenceName && seq.name !== sequenceName) {
            return JSON.stringify({ ok:false, error:'A sequência ativa mudou. Esperado: ' + sequenceName + ', atual: ' + seq.name });
        }

        var file = new File(srtPath);
        if (!file.exists) return JSON.stringify({ ok:false, error:'SRT não encontrado: ' + srtPath });

        var root = app.project.rootItem;
        var imported = $._ViniciusCaptionBridge._findItemByName(root, file.name);
        if (!imported) {
            var okImport = app.project.importFiles([file.fsName], true, root, false);
            if (!okImport) return JSON.stringify({ ok:false, error:'Premiere não importou o SRT.' });
            imported = $._ViniciusCaptionBridge._findItemByName(root, file.name);
        }
        if (!imported) return JSON.stringify({ ok:false, error:'SRT importado, mas ProjectItem não foi localizado.' });

        var ok = seq.createCaptionTrack(imported, 0);
        return JSON.stringify({ ok:!!ok, sequence:seq.name, item:imported.name, error: ok ? '' : 'createCaptionTrack retornou false.' });
    } catch (e) {
        return JSON.stringify({ ok:false, error:String(e), line:e.line || 0 });
    }
};
