jsPlumb.ready(function() {
      const canvas      = document.getElementById('canvas');
      const linkPopup   = document.getElementById('linkPopup');
      const fileInput   = document.getElementById('fileInput');
      const imageInput  = document.getElementById('imageInput');
      const themeToggle = document.getElementById('themeToggle');
      const colorPicker = document.getElementById('colorPicker');
      const tagDialog      = document.getElementById('tagDialog');
      const tagInput       = document.getElementById('tagInput');
      const tagSuggestions = document.getElementById('tagSuggestions');
      const tagOkBtn       = document.getElementById('tagOkBtn');
      const tagCancelBtn   = document.getElementById('tagCancelBtn');
      const fontSizeSelect = document.getElementById('fontSizeSelect');
      let currentZoom=1, selectedNode=null, offsetCount=0, clipboardData=null;

      // Prevent toolbar buttons stealing focus
      document.querySelectorAll('#toolbar button')
              .forEach(b=>b.addEventListener('mousedown', e=>e.preventDefault()));

      const getVar = n=>getComputedStyle(document.body).getPropertyValue(n).trim();
      const normalizeColor = str=> {
        if(!str||str==='transparent'||str==='rgba(0, 0, 0, 0)') return null;
        if(/^#[0-9A-Fa-f]{3}$/.test(str))
          return `#${str[1]}${str[1]}${str[2]}${str[2]}${str[3]}${str[3]}`.toLowerCase();
        if(/^#[0-9A-Fa-f]{6}$/.test(str)) return str.toLowerCase();
        try {
          const ctx = document.createElement('canvas').getContext('2d');
          ctx.fillStyle = str;
          return ctx.fillStyle;
        } catch {
          return str;
        }
      };

      const instance = jsPlumb.getInstance({
        Connector: ['Bezier',{curviness:50}],
        Endpoint: ['Blank',{}],
        PaintStyle: { stroke:getVar('--connector-color'), strokeWidth:2 },
        ConnectionOverlays: [['Arrow',{ width:10, length:10, location:1 }]],
        Container: 'canvas',
        RenderMode: 'canvas'
      });

      // Theme toggle
      themeToggle.onclick = ()=>{
        document.body.classList.toggle('dark');
        const c = getVar('--connector-color');
        instance.importDefaults({ PaintStyle:{ stroke:c, strokeWidth:2 } });
        instance.getAllConnections().forEach(cn=>cn.setPaintStyle({ stroke:c, strokeWidth:2 }));
      };

      // Resize canvas to fit
      function updateCanvasSize(){
        let mx=0,my=0;
        document.querySelectorAll('.node').forEach(n=>{
          mx = Math.max(mx, n.offsetLeft + n.offsetWidth);
          my = Math.max(my, n.offsetTop  + n.offsetHeight);
        });
        canvas.style.width  = (mx + 200) + 'px';
        canvas.style.height = (my + 200) + 'px';
      }

      // Resizing handle logic
      function setupResizing(nodeEl, handleEl){
        let sx, sy, sw, sh;
        const isImg  = nodeEl.classList.contains('image');
        const isCirc = nodeEl.classList.contains('circle');
        const minW   = isImg?50:(isCirc?50:100);
        const minH   = isImg?50:50;

        function doDrag(e){
          e.preventDefault();
          let nw = sw + (e.clientX - sx)/currentZoom;
          let nh = sh + (e.clientY - sy)/currentZoom;
          nw = Math.max(minW, nw);
          nh = Math.max(minH, nh);
          if(isImg){
            nodeEl.style.width  = nw + 'px';
            nodeEl.style.height = nh + 'px';
          } else if(isCirc){
            const s = Math.max(nw, nh);
            nodeEl.style.width  = nodeEl.style.height = s + 'px';
          } else {
            nodeEl.style.width  = nw + 'px';
            nodeEl.style.height = nh + 'px';
          }
          instance.revalidate(nodeEl.id);
        }
        function stopDrag(){
          document.documentElement.removeEventListener('mousemove', doDrag);
          document.documentElement.removeEventListener('mouseup', stopDrag);
          document.documentElement.removeEventListener('mouseleave', stopDrag);
          instance.revalidate(nodeEl.id);
          updateCanvasSize();
        }
        handleEl.onmousedown = e=>{
          e.preventDefault(); e.stopPropagation();
          sx = e.clientX; sy = e.clientY;
          sw = nodeEl.offsetWidth; sh = nodeEl.offsetHeight;
          document.documentElement.addEventListener('mousemove', doDrag);
          document.documentElement.addEventListener('mouseup', stopDrag);
          document.documentElement.addEventListener('mouseleave', stopDrag);
        };
      }

      // Tagging
      function updateTagConnections() {
        // 1. Clear existing tag-based connections
        const connectionsToDelete = instance.getAllConnections().filter(conn => conn.getParameter('tag-generated'));
        connectionsToDelete.forEach(conn => instance.deleteConnection(conn));

        // 2. Build a map of tags to nodes
        const tagMap = new Map();
        document.querySelectorAll('.node').forEach(node => {
          const tags = (node.dataset.tags || '').split(',').map(t => t.trim()).filter(t => t);
          tags.forEach(tag => {
            if (!tagMap.has(tag)) {
              tagMap.set(tag, []);
            }
            tagMap.get(tag).push(node.id);
          });
        });

        // 3. Create new connections
        const tagConnectorPaintStyle = {
          stroke: getVar('--tag-connector-color'),
          strokeWidth: 2,
          dashstyle: '2 2'
        };

        tagMap.forEach((nodeIds, tag) => {
          if (nodeIds.length > 1) {
            nodeIds.sort(); // Ensure consistent order for connection creation
            for (let i = 0; i < nodeIds.length; i++) {
              for (let j = i + 1; j < nodeIds.length; j++) {
                // Do not create a tag connection if a manual one already exists
                const existing = instance.getConnections({ source: nodeIds[i], target: nodeIds[j] });
                const existingReverse = instance.getConnections({ source: nodeIds[j], target: nodeIds[i] });
                if (existing.length === 0 && existingReverse.length === 0) {
                    instance.connect({
                        source: nodeIds[i],
                        target: nodeIds[j],
                        paintStyle: tagConnectorPaintStyle,
                        parameters: { 'tag-generated': true, 'tag': tag },
                    });
                }
              }
            }
          }
        });
      }

      // Node factory
      function makeNode(type, data={}){
        const id = data.id || 'node_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
        const node = document.createElement('div');
        node.className = 'node ' + type;
        node.id = id;
        // position
        if(data.left!==undefined) node.style.left = data.left;
        else node.style.left = (50 + offsetCount*20) + 'px';
        if(data.top!==undefined) node.style.top = data.top;
        else node.style.top = (50 + offsetCount*20) + 'px';
        offsetCount++;
        // angle
        node.dataset.angle = data.angle || 0;
        node.style.transform = `rotate(${node.dataset.angle}deg)`;
        // tags
        if (data.tags) node.dataset.tags = data.tags;
        // size
        if(data.width)  node.style.width  = data.width;
        if(data.height) node.style.height = data.height;

        if(type === 'image'){
          const img = document.createElement('img');
          img.src = data.imageData;
          img.style.width='100%'; img.style.height='100%'; img.style.objectFit='contain';
          node.appendChild(img);
        } else {
          const text = document.createElement('div');
          text.className = 'text';
          text.contentEditable = false;
          text.innerHTML = data.text || 'Node';
          if(data.color) node.style.backgroundColor = data.color;
          if(data.textStyles){
            if(data.textStyles.bold)      text.classList.add('text-bold');
            if(data.textStyles.italic)    text.classList.add('text-italic');
            if(data.textStyles.underline) text.classList.add('text-underline');
            if(data.textStyles.textAlign) text.style.textAlign = data.textStyles.textAlign;
            if(data.textStyles.fontSize)  text.style.fontSize   = data.textStyles.fontSize;
          }
          node.appendChild(text);
          text.addEventListener('dblclick', () => {
            text.contentEditable = true;
            text.focus();
            document.execCommand('selectAll', false, null);
          });
          text.onblur = ()=>{
            text.contentEditable = false;
            updateCanvasSize();
            instance.revalidate(node.id);
          };
        }

        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        node.appendChild(handle);
        setupResizing(node, handle);
        canvas.appendChild(node);

        node.onclick = e=>{
          const a = e.target.closest('a');
          if(a){
            e.preventDefault();
            if(e.shiftKey) window.open(a.href,'_blank');
            e.stopPropagation();
            return;
          }
          if(e.target===handle){
            e.stopPropagation();
            return;
          }
          if(selectedNode && selectedNode!==node) selectedNode.classList.remove('selected');
          selectedNode = node;
          node.classList.add('selected');
          //e.stopPropagation(); // Removed to allow dblclick to fire reliably.
        };

        instance.draggable(node,{
          filter: ".resize-handle, a",
          stop: p=>{
            p.el.style.left = p.pos[0] + 'px';
            p.el.style.top  = p.pos[1] + 'px';
            updateCanvasSize();
          }
        });
        const anchors = ['Top','Right','Bottom','Left'];
        instance.makeSource(node,{
          filter: type==='image'? 'img': '.text',
          anchor: anchors,
          connectorStyle: { stroke:getVar('--connector-color'), strokeWidth:2 },
          maxConnections: -1
        });
        instance.makeTarget(node,{
          anchor: anchors,
          maxConnections: -1,
          allowLoopback: false
        });

        return node;
      }

      instance.bind('connection', ()=> updateCanvasSize());
      instance.bind('dblclick', (c,e)=>{
        if (c.getParameter('tag-generated')) {
          // Do nothing, let the user remove the tag to remove the connection
          e.preventDefault();
          return;
        }
        instance.deleteConnection(c);
        updateTagConnections();
        e.preventDefault();
      });

      // Link popup
      canvas.onmouseover = e=>{
        const a = e.target.closest('a');
        if(a && a.closest('.node')){
          linkPopup.textContent = 'Shift+Click to Go to Link';
          linkPopup.style.left = e.pageX + 10 + 'px';
          linkPopup.style.top  = e.pageY + 10 + 'px';
          linkPopup.style.display = 'block';
        }
      };
      canvas.onmouseout = e=>{
        if(e.target.closest('a')) linkPopup.style.display = 'none';
      };
      canvas.onmouseleave = ()=> linkPopup.style.display = 'none';
      canvas.onclick = e=>{
        if(e.target===canvas && selectedNode){
          selectedNode.classList.remove('selected');
          selectedNode = null;
        }
      };

      // Toolbar
      document.getElementById('addRect').onclick    = ()=> makeNode('rect');
      document.getElementById('addCircle').onclick  = ()=> makeNode('circle');
      document.getElementById('addEllipse').onclick = ()=> makeNode('ellipse');

      // Import Image
      document.getElementById('importImgBtn').onclick = ()=> imageInput.click();
      imageInput.onchange = ()=>{
        const f = imageInput.files[0];
        if(!f) return;
        const r = new FileReader();
        r.onload = e=> makeNode('image',{ imageData:e.target.result });
        r.readAsDataURL(f);
        imageInput.value = '';
      };

      // Copy / Paste
      document.getElementById('copyBtn').onclick = ()=>{
        if(!selectedNode){ clipboardData=null; return; }
        const isImg = selectedNode.classList.contains('image');
        if(isImg){
          const img = selectedNode.querySelector('img');
          clipboardData = {
            shape:'image',
            imageData:img.src,
            width:selectedNode.style.width,
            height:selectedNode.style.height,
            angle:selectedNode.dataset.angle,
            tags: selectedNode.dataset.tags || ''
          };
        } else {
          const t = selectedNode.querySelector('.text');
          const def=normalizeColor(getVar('--node-bg'));
          const comp=normalizeColor(getComputedStyle(selectedNode).backgroundColor);
          clipboardData = {
            shape: selectedNode.classList.contains('circle')?'circle'
                 : selectedNode.classList.contains('ellipse')?'ellipse':'rect',
            width:selectedNode.style.width,
            height:selectedNode.style.height,
            text:  t.innerHTML,
            color: (comp&&comp!==def)?comp:null,
            textStyles:{
              bold:     t.classList.contains('text-bold'),
              italic:   t.classList.contains('text-italic'),
              underline:t.classList.contains('text-underline'),
              textAlign:t.style.textAlign,
              fontSize: t.style.fontSize
            },
            angle:selectedNode.dataset.angle,
            tags: selectedNode.dataset.tags || ''
          };
        }
      };
      document.getElementById('pasteBtn').onclick = ()=>{
        if(!clipboardData) return;
        if(selectedNode) selectedNode.classList.remove('selected');
        makeNode(clipboardData.shape, clipboardData);
        updateTagConnections();
      };

      // Text formatting
      function toggleCls(c){ if(!selectedNode) return; const t=selectedNode.querySelector('.text'); t.classList.toggle(c); t.focus(); }
      document.getElementById('boldBtn').onclick      = ()=> toggleCls('text-bold');
      document.getElementById('italicBtn').onclick    = ()=> toggleCls('text-italic');
      document.getElementById('underlineBtn').onclick = ()=> toggleCls('text-underline');
      fontSizeSelect.onchange = e => {
        if(!selectedNode) return;
        const t = selectedNode.querySelector('.text');
        if (!t) return;
        t.style.fontSize = e.target.value + 'px';
        instance.revalidate(selectedNode.id);
      };

      ['alignLeftBtn','alignCenterBtn','alignRightBtn'].forEach((id,i)=>{
        document.getElementById(id).onclick = ()=>{
          if(!selectedNode) return;
          selectedNode.querySelector('.text').style.textAlign = ['left','center','right'][i];
        };
      });
      document.getElementById('bulletBtn').onclick = ()=>{
        if(!selectedNode) return;
        const t = selectedNode.querySelector('.text');
        t.focus(); document.execCommand('insertUnorderedList');
      };
      document.getElementById('linkBtn').onclick = ()=>{
        if(!selectedNode) return;
        const t = selectedNode.querySelector('.text');
        t.focus();
        const url = prompt('URL:','https://');
        if(url){
          document.execCommand('createLink',false,url);
          t.querySelectorAll('a').forEach(a=>{a.target='_blank';a.rel='noopener';});
        }
      };

      document.getElementById('codeBtn').onclick = () => {
        if (!selectedNode) return;
        const textEl = selectedNode.querySelector('.text');
        if (document.activeElement !== textEl) return;

        const selection = window.getSelection();
        if (!selection.rangeCount || selection.isCollapsed) return;

        const range = selection.getRangeAt(0);
        const selectedFragment = range.extractContents();

        const pre = document.createElement('pre');
        const code = document.createElement('code');

        code.appendChild(selectedFragment);
        pre.appendChild(code);

        range.insertNode(pre);
        selection.removeAllRanges();
      };

      function getAllTags() {
        const allTags = new Set();
        document.querySelectorAll('.node[data-tags]').forEach(node => {
          (node.dataset.tags || '').split(',').forEach(tag => {
            const t = tag.trim();
            if (t) allTags.add(t);
          });
        });
        return [...allTags];
      }

      tagInput.addEventListener('input', () => {
        const allTags = getAllTags();
        const value = tagInput.value;
        const tags = value.split(',');
        const currentTag = tags[tags.length - 1].trim();

        tagSuggestions.innerHTML = '';
        if (currentTag.length === 0) {
          tagSuggestions.style.display = 'none';
          return;
        }

        const suggestions = allTags.filter(tag =>
          tag.toLowerCase().startsWith(currentTag.toLowerCase()) &&
          tag.toLowerCase() !== currentTag.toLowerCase()
        );

        if (suggestions.length > 0) {
          suggestions.forEach(suggestion => {
            const li = document.createElement('li');
            li.textContent = suggestion;
            tagSuggestions.appendChild(li);
          });
          tagSuggestions.style.display = 'block';
        } else {
          tagSuggestions.style.display = 'none';
        }
      });

      tagSuggestions.addEventListener('click', (e) => {
        if (e.target.tagName === 'LI') {
          const clickedTag = e.target.textContent;
          const tags = tagInput.value.split(',');
          tags[tags.length - 1] = clickedTag;
          tagInput.value = tags.join(', ');
          tagSuggestions.style.display = 'none';
          tagInput.focus();
        }
      });

      tagOkBtn.addEventListener('click', () => {
        if (selectedNode) {
          selectedNode.dataset.tags = tagInput.value.trim();
          updateTagConnections();
        }
        tagDialog.style.display = 'none';
        tagSuggestions.style.display = 'none';
      });

      tagCancelBtn.addEventListener('click', () => {
        tagDialog.style.display = 'none';
        tagSuggestions.style.display = 'none';
      });

      document.getElementById('tagBtn').onclick = ()=>{
        if (!selectedNode) return;
        tagInput.value = selectedNode.dataset.tags || '';
        tagDialog.style.display = 'flex';
        tagInput.focus();
        // Trigger input event to show initial suggestions if any
        tagInput.dispatchEvent(new Event('input', { bubbles: true }));
      };

      // Zoom / Rotate
      function applyZoom(){
        canvas.style.transform = `scale(${currentZoom})`;
        instance.setZoom(currentZoom);
        updateCanvasSize();
      }
      document.getElementById('zoomIn').onclick  = ()=>{ currentZoom*=1.1; applyZoom(); };
      document.getElementById('zoomOut').onclick = ()=>{ currentZoom/=1.1; applyZoom(); };
      function rotateSel(d){
        if(!selectedNode) return;
        let a = parseInt(selectedNode.dataset.angle||0) + d;
        selectedNode.dataset.angle = a;
        selectedNode.style.transform = `rotate(${a}deg)`;
        instance.revalidate(selectedNode.id);
      }
      document.getElementById('rotateLeft').onclick  = ()=> rotateSel(-15);
      document.getElementById('rotateRight').onclick = ()=> rotateSel(15);

      // Color picker
      colorPicker.oninput = ()=>{ if(selectedNode) selectedNode.style.backgroundColor = colorPicker.value; };

      // Save
      document.getElementById('saveBtn').onclick = ()=>{
        try {
          const nodesToSave = [];
          document.querySelectorAll('.node').forEach(n=>{
            const isImg = n.classList.contains('image');
            const base = {
              id: n.id,
              left: n.style.left,
              top:  n.style.top,
              width:  n.style.width  || getComputedStyle(n).width,
              height: n.style.height || getComputedStyle(n).height,
              angle:  n.dataset.angle || 0,
              tags: n.dataset.tags || ''
            };
            if(isImg){
              base.type = 'image';
              base.imageData = n.querySelector('img').src;
            } else {
              const t = n.querySelector('.text');
              const def= normalizeColor(getVar('--node-bg'));
              const comp= normalizeColor(getComputedStyle(n).backgroundColor);
              base.type = n.classList.contains('circle')?'circle'
                        : n.classList.contains('ellipse')?'ellipse':'rect';
              base.text = t.innerHTML;
              base.color= (comp&&comp!==def)?comp:null;
              base.textStyles = {
                bold:      t.classList.contains('text-bold'),
                italic:    t.classList.contains('text-italic'),
                underline: t.classList.contains('text-underline'),
                textAlign: t.style.textAlign,
                fontSize:  t.style.fontSize
              };
            }
            nodesToSave.push(base);
          });
          const conns = instance.getAllConnections().map(c=>({
            source: c.source.id,
            target: c.target.id
          }));
          const data = { nodes: nodesToSave, connections: conns };
          const json = JSON.stringify(data,null,2);
          const blob = new Blob([json],{type:'application/json'});
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href = url; a.download = 'onmymind.omm';
          document.body.appendChild(a); a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch(e) {
          alert('Error saving: '+e.message);
        }
      };

      // Load
      document.getElementById('loadBtn').onclick = ()=> fileInput.click();
      fileInput.onchange = ()=>{
        const f = fileInput.files[0]; if(!f) return;
        const r = new FileReader();
        r.onload = e=>{
          try {
            const obj = JSON.parse(e.target.result);
            instance.deleteEveryConnection();
            document.querySelectorAll('.node').forEach(n=>n.remove());
            offsetCount=0;
            obj.nodes.forEach(nd=> makeNode(nd.type||nd.type, nd));
            setTimeout(()=>{
              obj.connections.forEach(cn=>
                instance.connect({ source:cn.source, target:cn.target, type:'basic' })
              );
              updateCanvasSize();
              updateTagConnections();
            },50);
          } catch(er) {
            alert('Error loading: '+er.message);
          }
        };
        r.readAsText(f);
        fileInput.value = '';
      };

      // Export PNG
      document.getElementById('exportPngBtn').onclick = ()=>{
        try {
          instance.repaintEverything();
          canvas.querySelectorAll('canvas.jtk-connector').forEach(cc=>{
            cc.width  = canvas.scrollWidth;
            cc.height = canvas.scrollHeight;
            cc.style.width  = canvas.scrollWidth + 'px';
            cc.style.height = canvas.scrollHeight + 'px';
          });
          if(selectedNode) selectedNode.classList.remove('selected');
          const ox=window.scrollX, oy=window.scrollY;
          window.scrollTo(0,0);
          setTimeout(()=>{
            html2canvas(canvas,{
              scale:1,
              width:canvas.scrollWidth,
              height:canvas.scrollHeight,
              windowWidth:canvas.scrollWidth,
              windowHeight:canvas.scrollHeight,
              scrollX:0, scrollY:0,
              useCORS:true,
              allowTaint:true,
              foreignObjectRendering:true,
              backgroundColor:getVar('--canvas-bg')
            }).then(cEl=>{
              cEl.toBlob(blob=>{
                const a=document.createElement('a');
                a.href=URL.createObjectURL(blob);
                a.download='onmymind.png';
                document.body.appendChild(a); a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(a.href);
                if(selectedNode) selectedNode.classList.add('selected');
                window.scrollTo(ox,oy);
              });
            }).catch(err=>{
              alert('Error exporting PNG: '+err.message);
              if(selectedNode) selectedNode.classList.add('selected');
              window.scrollTo(ox,oy);
            });
          },200);
        } catch(e) {
          alert('Error exporting PNG: '+e.message);
        }
      };

      // Export PDF
      document.getElementById('exportPdfBtn').onclick = ()=>{
        try {
          instance.repaintEverything();
          canvas.querySelectorAll('canvas.jtk-connector').forEach(cc=>{
            cc.width  = canvas.scrollWidth;
            cc.height = canvas.scrollHeight;
            cc.style.width  = canvas.scrollWidth + 'px';
            cc.style.height = canvas.scrollHeight + 'px';
          });
          if(selectedNode) selectedNode.classList.remove('selected');
          const ox=window.scrollX, oy=window.scrollY;
          window.scrollTo(0,0);
          setTimeout(()=>{
            html2canvas(canvas,{
              scale:1,
              width:canvas.scrollWidth,
              height:canvas.scrollHeight,
              windowWidth:canvas.scrollWidth,
              windowHeight:canvas.scrollHeight,
              scrollX:0,scrollY:0,
              useCORS:true,
              allowTaint:true,
              foreignObjectRendering:true,
              backgroundColor:getVar('--canvas-bg')
            }).then(cEl=>{
              const imgData=cEl.toDataURL('image/png');
              const { jsPDF } = window.jspdf;
              const orient= canvas.scrollWidth>canvas.scrollHeight?'l':'p';
              const pdf=new jsPDF({orientation:orient,unit:'pt',format:[canvas.scrollWidth,canvas.scrollHeight]});
              pdf.addImage(imgData,'PNG',0,0,canvas.scrollWidth,canvas.scrollHeight);
              pdf.save('onmymind.pdf');
              if(selectedNode) selectedNode.classList.add('selected');
              window.scrollTo(ox,oy);
            }).catch(err=>{
              alert('Error exporting PDF: '+err.message);
              if(selectedNode) selectedNode.classList.add('selected');
              window.scrollTo(ox,oy);
            });
          },200);
        } catch(e) {
          alert('Error exporting PDF: '+e.message);
        }
      };

      // Delete with Backspace/Delete
      document.addEventListener('keydown',e=>{
        if((e.key==='Delete'||e.key==='Backspace')&&selectedNode){
          instance.remove(selectedNode);
          selectedNode=null;
          updateCanvasSize();
          updateTagConnections();
          e.preventDefault();
        }
      });

      // Initial layout
      updateCanvasSize();
    });
