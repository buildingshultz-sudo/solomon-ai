'use strict';

const fs = require('fs');
const path = require('path');

let ChartJSNodeCanvas = null;

// Lazy-load chartjs-node-canvas to avoid crash if not installed
function getRenderer(width, height) {
  if (!ChartJSNodeCanvas) {
    try {
      const mod = require('chartjs-node-canvas');
      ChartJSNodeCanvas = mod.ChartJSNodeCanvas;
    } catch (err) {
      throw new Error('chartjs-node-canvas not installed. Run: npm install chartjs-node-canvas chart.js');
    }
  }
  return new ChartJSNodeCanvas({ width: width || 800, height: height || 600 });
}

// Generate a bar chart and save as PNG
async function generateBarChart(labels, data, title, outputPath) {
  const renderer = getRenderer(800, 600);
  const config = {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: title || 'Data',
        data: data,
        backgroundColor: [
          '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
          '#9966FF', '#FF9F40', '#C9CBCF', '#7BC8A4'
        ].slice(0, data.length),
        borderWidth: 1
      }]
    },
    options: {
      plugins: {
        title: { display: true, text: title || 'Bar Chart', font: { size: 18 } }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  };

  const buffer = await renderer.renderToBuffer(config);
  const resolvedPath = path.resolve(outputPath || `./chart_bar_${Date.now()}.png`);
  fs.writeFileSync(resolvedPath, buffer);
  return resolvedPath;
}

// Generate a line chart and save as PNG
async function generateLineChart(labels, data, title, outputPath) {
  const renderer = getRenderer(800, 600);
  const datasets = Array.isArray(data[0])
    ? data.map((d, i) => ({
        label: `Series ${i + 1}`,
        data: d,
        borderColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0'][i % 4],
        fill: false,
        tension: 0.1
      }))
    : [{
        label: title || 'Data',
        data: data,
        borderColor: '#36A2EB',
        fill: false,
        tension: 0.1
      }];

  const config = {
    type: 'line',
    data: { labels: labels, datasets: datasets },
    options: {
      plugins: {
        title: { display: true, text: title || 'Line Chart', font: { size: 18 } }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  };

  const buffer = await renderer.renderToBuffer(config);
  const resolvedPath = path.resolve(outputPath || `./chart_line_${Date.now()}.png`);
  fs.writeFileSync(resolvedPath, buffer);
  return resolvedPath;
}

// Generate a pie chart and save as PNG
async function generatePieChart(labels, data, title, outputPath) {
  const renderer = getRenderer(800, 600);
  const config = {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: [
          '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
          '#9966FF', '#FF9F40', '#C9CBCF', '#7BC8A4',
          '#E7E9ED', '#FF6B6B'
        ].slice(0, data.length)
      }]
    },
    options: {
      plugins: {
        title: { display: true, text: title || 'Pie Chart', font: { size: 18 } }
      }
    }
  };

  const buffer = await renderer.renderToBuffer(config);
  const resolvedPath = path.resolve(outputPath || `./chart_pie_${Date.now()}.png`);
  fs.writeFileSync(resolvedPath, buffer);
  return resolvedPath;
}

// Generate a doughnut chart and save as PNG
async function generateDoughnutChart(labels, data, title, outputPath) {
  const renderer = getRenderer(800, 600);
  const config = {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: [
          '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
          '#9966FF', '#FF9F40', '#C9CBCF', '#7BC8A4'
        ].slice(0, data.length)
      }]
    },
    options: {
      plugins: {
        title: { display: true, text: title || 'Doughnut Chart', font: { size: 18 } }
      }
    }
  };

  const buffer = await renderer.renderToBuffer(config);
  const resolvedPath = path.resolve(outputPath || `./chart_doughnut_${Date.now()}.png`);
  fs.writeFileSync(resolvedPath, buffer);
  return resolvedPath;
}

module.exports = {
  generateBarChart,
  generateLineChart,
  generatePieChart,
  generateDoughnutChart
};
